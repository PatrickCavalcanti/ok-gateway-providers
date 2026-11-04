// ok-gateway-providers — o cliente (spec §5).
//
// `createClient({ account, model }).chat(request)` devolve um Run: async iterable de
// eventos (`text`, `reasoning`, `tool_call`, `end`) com `run.result`. O pedido começa na
// criação; os eventos esperam numa fila. A lib não repete chamada nem guarda nada.

import { ProviderError, errorFromStatus, unsupported } from './errors.js';
import { createDeadline, OPERATION_TIMEOUTS } from './timeouts.js';
import { readSSE } from './sse.js';
import { resolveCompat } from './compat.js';
import { computeCost } from './cost.js';
import { METHODS_BY_OPERATION } from './vocabulary.js';

/** @typedef {import('./types.js').Account} Account */
/** @typedef {import('./types.js').Model} Model */
/** @typedef {import('./types.js').ChatRequest} ChatRequest */
/** @typedef {import('./types.js').ChatEvent} ChatEvent */
/** @typedef {import('./types.js').ChatResult} ChatResult */
/** @typedef {import('./types.js').ApiModule} ApiModule */
/** @typedef {import('./types.js').Client} Client */
/** @typedef {import('./types.js').OperationTypes} OperationTypes */

/** @type {Map<string, ApiModule>} */
const APIS = new Map();

/** Registra um fio. Os do núcleo são registrados pelo `index.js`. @param {ApiModule} mod */
export function registerApi(mod) {
  if (!mod?.api || typeof mod.buildRequest !== 'function' || typeof mod.parseStream !== 'function') {
    throw new TypeError('fio precisa de api, buildRequest e parseStream');
  }
  APIS.set(mod.api, mod);
}

/** @param {string} api */
export function getApi(api) { return APIS.get(api); }

/** Fios registrados. */
export function listApis() { return [...APIS.keys()]; }

/**
 * Os métodos de operação saem de `METHODS_BY_OPERATION` (spec §3): operação nova na tabela ganha o método sem
 * editar o cliente. O tipo de cada método é o do typedef `Client`, que um teste confere contra a tabela.
 * @param {{ account: Account, model: Model, fetch?: typeof globalThis.fetch }} opts
 * @returns {Client}
 */
export function createClient({ account, model, fetch: fetchImpl }) {
  if (!account || typeof account !== 'object') throw new TypeError('createClient: account é obrigatório');
  if (!model || typeof model !== 'object') throw new TypeError('createClient: model é obrigatório');
  const doFetch = fetchImpl ?? globalThis.fetch;
  /** @type {Record<string, unknown>} */
  const client = {
    account,
    model,
    chat: (/** @type {ChatRequest} */ request) => startChat({ account, model, request, doFetch }),
  };
  for (const [operation, methods] of Object.entries(METHODS_BY_OPERATION)) {
    if (operation === 'chat') continue;
    const op = /** @type {keyof OperationTypes} */ (operation);
    for (const method of methods) {
      client[method] = (/** @type {any} */ request) => runOperation(op, { account, model, request, doFetch });
    }
  }
  return /** @type {Client} */ (client);
}

/**
 * @typedef {AsyncIterable<ChatEvent> & { result: Promise<ChatResult>, abort(): void }} Run
 */

/**
 * @param {{ account: Account, model: Model, request: ChatRequest, doFetch: typeof globalThis.fetch }} args
 * @returns {Run}
 */
function startChat({ account, model, request, doFetch }) {
  const queue = createQueue();
  const local = new AbortController();
  // Um `signal` que não é AbortSignal vira invalid_request lá dentro, não TypeError aqui.
  const callerSignal = isAbortSignal(request?.signal) ? request.signal : undefined;
  const onCallerAbort = () => local.abort();
  if (callerSignal?.aborted) local.abort();
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

  /** @type {(v: ChatResult) => void} */ let resolveResult = () => {};
  /** @type {(e: unknown) => void} */ let rejectResult = () => {};
  /** @type {Promise<ChatResult>} */
  const result = new Promise((res, rej) => { resolveResult = res; rejectResult = rej; });
  result.catch(() => {}); // quem não olha o result não ganha unhandled rejection

  const ctx = { provider: account.provider, model: model.id };
  let emitted = false;
  /** @type {string|undefined} */
  let generationId;

  (async () => {
    /** @type {ReturnType<typeof createDeadline>|undefined} */
    let deadline;
    try {
      assertSignal(request?.signal, ctx);
      deadline = createDeadline({ timeouts: { ...account.timeouts, ...request?.timeouts }, signal: local.signal });
      if (!Array.isArray(model.operations) || !model.operations.includes('chat')) {
        throw unsupported(`${account.provider}/${model.id}: o modelo não declara a operação chat`, ctx);
      }
      const api = APIS.get(account.api);
      if (!api) throw unsupported(`${account.provider}/${model.id}: fio "${account.api}" não suportado por esta versão`, ctx);
      if (!request || !Array.isArray(request.messages)) {
        throw new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, message: 'chat: messages precisa ser uma lista' });
      }

      const compat = resolveCompat(account, model);
      if (local.signal.aborted) throw fromFailure(new Error('aborted'), 'aborted', ctx, false);

      const apiKey = await resolveKey(account, ctx);
      const built = buildOrThrow(api.buildRequest, { account, model, compat, request, apiKey }, ctx);
      // Ordem: headers fixos da conta ← compat (conta ← modelo) ← os do fio (auth, content-type), que não se sobrescrevem.
      const headers = mergeHeaders(account.headers, compat.headers, built.headers);
      const payload = serializeBody(built.body, ctx);
      if (local.signal.aborted) throw fromFailure(new Error('aborted'), 'aborted', ctx, false);

      /** @type {Response} */
      let res;
      try {
        res = await doFetch(built.url, { method: 'POST', headers, body: payload, signal: deadline.signal });
      } catch (err) {
        throw fromFailure(err, deadline.reason(), ctx, false);
      }
      generationId = generationIdOf(res.headers);
      if (!res.ok) {
        let text = '';
        try { text = await res.text(); } catch { /* corpo ilegível: fica o status */ }
        if (deadline.reason()) throw fromFailure(new Error('corpo de erro encerrado'), deadline.reason(), ctx, false);
        throw errorFromStatus(res.status, { ...ctx, body: text });
      }
      if (!res.body) throw new ProviderError({ type: 'upstream', ...ctx, message: `${ctx.provider}/${ctx.model}: resposta sem corpo` });

      const events = readSSE(res.body, { onChunk: () => deadline?.touch() });
      const gen = api.parseStream(events, { account, model, compat, headers: res.headers });
      /** @type {import('./types.js').StreamSummary} */
      let summary;
      try {
        while (true) {
          const step = await gen.next();
          if (step.done) { summary = step.value; break; }
          emitted = true;
          queue.push(step.value);
        }
      } catch (err) {
        throw fromFailure(err, deadline.reason(), ctx, emitted);
      }
      if (deadline.reason()) throw fromFailure(new Error('stream encerrado'), deadline.reason(), ctx, emitted);

      const cost = computeCost(model, summary.usage, summary.reportedCostUsd);
      /** @type {ChatResult} */
      const final = { finishReason: summary.finishReason, usage: summary.usage, cost, ...(generationId ? { generationId } : {}) };
      queue.push({ type: 'end', ...final });
      queue.close();
      resolveResult(final);
    } catch (err) {
      const e = err instanceof ProviderError ? err : fromFailure(err, deadline?.reason() ?? null, ctx, emitted);
      if (emitted) e.emitted = true;
      // Um ponto só: vale para todo erro depois do fetch, venha do status, do stream ou do prazo.
      if (generationId && !e.generationId) e.generationId = generationId;
      queue.fail(e);
      rejectResult(e);
    } finally {
      deadline?.clear();
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  })();

  return {
    result,
    /** Cancela o pedido; a iteração e o result terminam com `aborted`. */
    abort() { local.abort(); },
    [Symbol.asyncIterator]() {
      const it = queue.iterator();
      return {
        next: () => it.next(),
        /** Sair do `for await` cancela o pedido. */
        async return() { local.abort(); return { done: true, value: undefined }; },
      };
    },
  };
}

/**
 * Chave da conta. Falha vira `auth`.
 * @param {Account} account @param {{ provider: string, model: string }} ctx
 * @returns {Promise<string>}
 */
async function resolveKey(account, ctx) {
  try {
    const key = typeof account.apiKey === 'function' ? await account.apiKey() : account.apiKey;
    return key ?? '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError({ type: 'auth', ...ctx, cause: err, message: `${ctx.provider}/${ctx.model}: não foi possível obter a chave da conta — ${msg}` });
  }
}

/**
 * Monta o pedido. Erro não tipado = pedido malformado: outro alvo não resolve.
 * @template A, R
 * @param {(args: A) => R} fn @param {A} args @param {{ provider: string, model: string }} ctx
 * @returns {R}
 */
function buildOrThrow(fn, args, ctx) {
  try { return fn(args); } catch (err) {
    if (err instanceof ProviderError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, cause: err, message: `${ctx.provider}/${ctx.model}: pedido malformado — ${msg}` });
  }
}

/**
 * Corpo → o que o fetch recebe. FormData segue como está (o fetch gera o Content-Type com o boundary). Corpo que
 * não serializa (referência circular, BigInt) é pedido malformado: outro alvo não resolve, e não é "falha de rede".
 * @param {Record<string, unknown> | FormData} body @param {{ provider: string, model: string }} ctx
 * @returns {string | FormData}
 */
function serializeBody(body, ctx) {
  if (body instanceof FormData) return body;
  try { return JSON.stringify(body); } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, cause: err, message: `${ctx.provider}/${ctx.model}: pedido malformado — o corpo não serializa em JSON (${msg})` });
  }
}

/** @param {unknown} v @returns {v is AbortSignal} */
const isAbortSignal = (v) => !!v && typeof v === 'object' && typeof (/** @type {any} */ (v)).addEventListener === 'function' && 'aborted' in v;

/**
 * `signal` que o chamador passou e não é um AbortSignal: pedido malformado, não TypeError cru.
 * @param {unknown} signal @param {{ provider: string, model: string }} ctx
 */
function assertSignal(signal, ctx) {
  if (signal !== undefined && signal !== null && !isAbortSignal(signal)) {
    throw new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, message: `${ctx.provider}/${ctx.model}: pedido malformado — signal precisa ser um AbortSignal` });
  }
}

/** Id da geração no provedor (header `x-generation-id`), quando veio. @param {Headers} headers @returns {string|undefined} */
function generationIdOf(headers) {
  const id = headers?.get?.('x-generation-id');
  return id ? id : undefined;
}

/**
 * Operação de chamada única (embeddings, transcrição, fala, imagem, decisão). O pedido e o resultado
 * de cada uma estão em `OperationTypes`.
 * @template {keyof OperationTypes} O
 * @param {O} operation
 * @param {{ account: Account, model: Model, request: OperationTypes[O][0], doFetch: typeof globalThis.fetch }} args
 * @returns {Promise<OperationTypes[O][1]>}
 */
async function runOperation(operation, { account, model, request, doFetch }) {
  const ctx = { provider: account.provider, model: model.id };
  /** @type {ReturnType<typeof createDeadline>|undefined} */
  let deadline;
  /** @type {string|undefined} */
  let generationId;
  try {
    assertSignal(request?.signal, ctx);
    deadline = createDeadline({ timeouts: { ...OPERATION_TIMEOUTS[operation], ...account.timeouts, ...request?.timeouts }, signal: request?.signal });
    if (!Array.isArray(model.operations) || !model.operations.includes(operation)) {
      throw unsupported(`${ctx.provider}/${ctx.model}: o modelo não declara a operação ${operation}`, ctx);
    }
    const api = APIS.get(account.api);
    const mod = api?.operations?.[operation];
    if (!mod) throw unsupported(`${ctx.provider}/${ctx.model}: o fio "${account.api}" não implementa ${operation}`, ctx);

    const compat = resolveCompat(account, model);
    const opCtx = { account, model, compat, request: request ?? {} };
    const apiKey = await resolveKey(account, ctx);
    const built = buildOrThrow(mod.buildRequest, { ...opCtx, apiKey }, ctx);
    const headers = mergeHeaders(account.headers, compat.headers, built.headers);
    const payload = serializeBody(built.body, ctx);

    /** @type {Response} */
    let res;
    try {
      res = await doFetch(built.url, { method: 'POST', headers, body: payload, signal: deadline.signal });
    } catch (err) {
      throw fromFailure(err, deadline.reason(), ctx, false);
    }
    generationId = generationIdOf(res.headers);
    if (!res.ok) {
      let text = '';
      try { text = await res.text(); } catch { /* corpo ilegível: fica o status */ }
      if (deadline.reason()) throw fromFailure(new Error('corpo de erro encerrado'), deadline.reason(), ctx, false);
      throw errorFromStatus(res.status, { ...ctx, body: text });
    }
    deadline.touch(); // chegaram os headers: acaba o primeiro byte, começa a inatividade

    const { result, usage, reportedCostUsd } = await mod.parseResponse(oneShot(res, deadline, ctx), opCtx);
    if (deadline.reason()) throw fromFailure(new Error('corpo encerrado'), deadline.reason(), ctx, false);
    return /** @type {OperationTypes[O][1]} */ (/** @type {unknown} */ ({
      ...result, usage, cost: computeCost(model, usage, reportedCostUsd), ...(generationId ? { generationId } : {}),
    }));
  } catch (err) {
    const e = err instanceof ProviderError ? err : fromFailure(err, deadline?.reason() ?? null, ctx, false);
    if (generationId && !e.generationId) e.generationId = generationId; // um ponto só, como no chat
    throw e;
  } finally {
    deadline?.clear();
  }
}

/**
 * Resposta inteira, lendo o corpo com o relógio de inatividade.
 * @param {Response} res @param {ReturnType<typeof createDeadline>} deadline
 * @param {{ provider: string, model: string }} ctx
 * @returns {import('./types.js').OneShotResponse}
 */
function oneShot(res, deadline, ctx) {
  /** @type {Promise<Uint8Array>|undefined} */
  let memo;
  const read = async () => {
    if (!res.body) return new Uint8Array();
    /** @type {Uint8Array[]} */
    const chunks = [];
    let total = 0;
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      deadline.touch();
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  };
  // O corpo só pode ser lido uma vez: json() e bytes() dividem a mesma leitura.
  const bytes = () => (memo ??= read());
  return {
    status: res.status,
    headers: res.headers,
    bytes,
    async json() {
      const raw = new TextDecoder().decode(await bytes());
      try { return JSON.parse(raw); } catch (err) {
        throw new ProviderError({ type: 'upstream', ...ctx, cause: err, body: raw, message: `${ctx.provider}/${ctx.model}: resposta não é JSON` });
      }
    },
  };
}

/**
 * Traduz uma falha de fetch/leitura no erro tipado.
 * @param {unknown} err @param {import('./timeouts.js').DeadlineReason} reason
 * @param {{ provider: string, model: string }} ctx @param {boolean} emitted
 */
function fromFailure(err, reason, ctx, emitted) {
  if (err instanceof ProviderError) { if (emitted) err.emitted = true; return err; }
  if (reason === 'aborted') {
    return new ProviderError({ type: 'aborted', retryOther: false, emitted, ...ctx, cause: err, message: `${ctx.provider}/${ctx.model}: pedido cancelado pelo chamador` });
  }
  if (reason) {
    const label = { first_byte: 'primeiro byte', idle: 'inatividade do stream', total: 'tempo total' }[reason];
    return new ProviderError({ type: 'timeout', emitted, ...ctx, cause: err, message: `${ctx.provider}/${ctx.model}: prazo estourado (${label})` });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new ProviderError({ type: 'upstream', emitted, ...ctx, cause: err, message: `${ctx.provider}/${ctx.model}: falha de rede ou leitura — ${msg}` });
}

/**
 * Merge de headers sem diferença de caixa (`Authorization` e `authorization` são o mesmo):
 * a última camada vence. As chaves saem em minúsculas.
 * @param {...(Record<string, string>|undefined)} layers
 */
function mergeHeaders(...layers) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const layer of layers) for (const [k, v] of Object.entries(layer ?? {})) out[k.toLowerCase()] = v;
  return out;
}

/** Fila de um produtor e um consumidor. */
function createQueue() {
  /** @type {ChatEvent[]} */ const items = [];
  /** @type {((r: IteratorResult<ChatEvent>) => void)[]} */ const waiters = [];
  /** @type {((e: unknown) => void)[]} */ const failers = [];
  let closed = false;
  /** @type {unknown} */ let error = null;

  const flush = () => {
    while (waiters.length && (items.length || closed || error)) {
      const resolve = /** @type {(r: IteratorResult<ChatEvent>) => void} */ (waiters.shift());
      const reject = /** @type {(e: unknown) => void} */ (failers.shift());
      if (items.length) resolve({ done: false, value: /** @type {ChatEvent} */ (items.shift()) });
      else if (error) reject(error);
      else resolve({ done: true, value: undefined });
    }
  };
  return {
    push(/** @type {ChatEvent} */ ev) { items.push(ev); flush(); },
    close() { closed = true; flush(); },
    fail(/** @type {unknown} */ e) { error = e; flush(); },
    iterator() {
      return {
        /** @returns {Promise<IteratorResult<ChatEvent>>} */
        next() {
          return new Promise((resolve, reject) => { waiters.push(resolve); failers.push(reject); flush(); });
        },
      };
    },
  };
}
