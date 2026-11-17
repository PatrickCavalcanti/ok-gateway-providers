// ok-gateway-providers — fio `openai-responses` (spec T1.2 §7).
//
// Responses API em SSE: `POST {base}/responses`. OpenAI e os servidores que copiam o formato
// (llama.cpp). O cliente (`client.js`) faz o fetch, o status HTTP, os prazos e o custo; este
// módulo monta o pedido e lê o stream. Diferença entre provedores é campo do compat — não há `if`
// por provedor aqui. Todo item de `input` leva `type` explícito: o llama.cpp recusa item sem tipo.

import { ProviderError, errorFromStatus, unsupported } from '../errors.js';
import { assertMediaSupported, defaultFilename, parseDataUrl } from '../attachments.js';
import { makeUsage, num, reportedCost } from '../usage.js';
import { applyParams, fuse } from '../params.js';

/** @typedef {import('../types.js').ApiModule} ApiModule */
/** @typedef {import('../types.js').Message} Message */
/** @typedef {import('../types.js').Part} Part */
/** @typedef {import('../types.js').Model} Model */
/** @typedef {{ provider: string, model: string }} Ctx */

export const api = /** @type {const} */ ('openai-responses');

// Embeddings, áudio, imagem e decisão não mudam entre os dois fios da OpenAI.
export { operations } from './openai-completions.js';

/** Chaves do corpo que `params` nunca sobrescreve: o fio é dono delas. */
const PROTECTED_KEYS = new Set(['model', 'input', 'stream', 'tools']);

/** Este fio não tem campo de erro no resultado da tool: o aviso vai no texto (spec T1.2 §6). */
const TOOL_ERROR_PREFIX = 'Tool error: ';

/**
 * Monta o pedido HTTP. Lança `unsupported` / `invalid_request` antes do fetch.
 * @type {ApiModule['buildRequest']}
 */
export function buildRequest({ account, model, compat, request, apiKey }) {
  /** @type {Ctx} */
  const ctx = { provider: account.provider, model: model.id };
  if (request.cachedContent !== undefined) {
    throw unsupported(`${ctx.provider}/${ctx.model}: cachedContent só existe no fio google-generative-ai`, ctx);
  }
  const stop = stopOf(request, ctx);
  if (stop) throw unsupported(`${ctx.provider}/${ctx.model}: a Responses API não tem stop (textos que encerram a geração)`, ctx);

  const url = `${account.baseUrl.replace(/\/+$/, '')}/responses`;
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  /** @type {Record<string, any>} */
  const body = {
    model: model.id,
    input: buildInput(request, { model, provider: account.provider }),
    stream: true,
  };

  if (request.tools?.length) {
    // Formato plano: sem o envelope `function` do Chat Completions.
    body.tools = request.tools.map((t) => ({
      type: 'function',
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      parameters: t.parameters ?? { type: 'object', properties: {} },
    }));
  }

  const choice = toolChoiceOf(request, ctx);

  if (request.responseSchema && compat.structuredOutput !== 'top_level_json_schema' && compat.structuredOutput !== 'text_format') {
    // 'none' (ou um formato de outro fio): não dá para afirmar que o endpoint aplica o schema, e
    // ignorar entregaria texto livre a quem pediu JSON.
    throw unsupported(`${ctx.provider}/${ctx.model}: este modelo/conta não suporta saída estruturada neste fio (compat.structuredOutput = ${compat.structuredOutput}; use "text_format")`, ctx);
  }

  // Orçamento (`reasoning.maxTokens`/`exclude`) não existe na Responses API, qualquer que seja o formato.
  // Esforço com reasoningFormat 'none' é dica de custo/latência e é ignorado sem erro.
  const budget = request.reasoning;
  if (budget && (budget.maxTokens !== undefined || budget.exclude !== undefined)) {
    throw unsupported(`${ctx.provider}/${ctx.model}: reasoning.maxTokens/exclude não existem na Responses API; use effort`, ctx);
  }
  if (request.effort !== undefined && compat.reasoningFormat !== 'reasoning_object' && compat.reasoningFormat !== 'none') {
    throw unsupported(`${ctx.provider}/${ctx.model}: reasoningFormat "${compat.reasoningFormat}" não existe no fio openai-responses`, ctx);
  }

  if (compat.supportsStore) body.store = false;

  // params: do modelo, depois da chamada (o último vence). Nunca sobrescrevem o que é do fio
  // (PROTECTED_KEYS); descartar uma chave protegida é deliberado e não gera erro.
  // `provider` (roteamento do OpenRouter) só passa com compat.providerRouting.
  applyParams(body, [model.params, request.params], (k) => PROTECTED_KEYS.has(k) || (k === 'provider' && !compat.providerRouting));

  // Campos de controle do pedido, num bloco só, depois dos params: o explícito vence. Objeto funde campo a campo
  // (`text.verbosity`, `reasoning.summary`… dos params ficam). `model.maxTokens` é o TETO do modelo, não um valor a enviar.
  if (request.responseSchema) {
    const { name, schema, strict } = request.responseSchema;
    if (compat.structuredOutput === 'top_level_json_schema') {
      body.json_schema = schema; // extensão do llama.cpp: o /v1/responses dele ignora text.format e devolve texto livre
    } else {
      fuse(body, 'text', { format: { type: 'json_schema', name: name ?? 'response', strict: strict ?? true, schema } });
    }
  }
  if (request.effort !== undefined && compat.reasoningFormat === 'reasoning_object') fuse(body, 'reasoning', { effort: request.effort });
  if (request.maxTokens !== undefined) body[compat.maxTokensField] = request.maxTokens;
  if (request.temperature !== undefined && compat.supportsTemperature) body.temperature = request.temperature;
  if (choice !== undefined) body.tool_choice = typeof choice === 'string' ? choice : { type: 'function', name: choice.name };

  return { url, headers, body };
}

/**
 * `toolChoice` do pedido, conferido. Sem `tools` não há o que escolher: `invalid_request`, sem outro alvo.
 * @param {import('../types.js').ChatRequest} request @param {Ctx} ctx
 * @returns {import('../types.js').ToolChoice | undefined}
 */
function toolChoiceOf(request, ctx) {
  const choice = request.toolChoice;
  if (choice === undefined) return undefined;
  if (!request.tools?.length) throw invalid('toolChoice exige tools no pedido', ctx);
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice;
  if (choice && typeof choice === 'object' && typeof choice.name === 'string' && choice.name) return choice;
  throw invalid('toolChoice precisa ser "auto", "none", "required" ou { name }', ctx);
}

/**
 * `stop` do pedido, conferido. Lista vazia é o mesmo que não pedir.
 * @param {import('../types.js').ChatRequest} request @param {Ctx} ctx @returns {string[] | undefined}
 */
function stopOf(request, ctx) {
  const stop = request.stop;
  if (stop === undefined) return undefined;
  if (!Array.isArray(stop) || stop.some((s) => typeof s !== 'string')) throw invalid('stop precisa ser uma lista de textos', ctx);
  return stop.length ? stop : undefined;
}

// ---------------------------------------------------------------------------------------
// input

/**
 * Mensagens da lib → itens de `input`. Todo item leva `type`.
 * @param {import('../types.js').ChatRequest} request @param {{ model: Model, provider: string }} ctx
 */
function buildInput(request, { model, provider }) {
  /** @type {Ctx} */
  const ctx = { provider, model: model.id };
  if (!Array.isArray(request.messages)) throw invalid('messages precisa ser uma lista', ctx);
  /** @type {Record<string, unknown>[]} */
  const out = [];

  const system = systemText(request.system);
  if (system !== undefined) out.push({ type: 'message', role: 'system', content: system });

  request.messages.forEach((msg, i) => {
    const where = `messages[${i}]`;
    if (!msg || typeof msg !== 'object') throw invalid(`${where}: mensagem malformada (esperado um objeto)`, ctx);

    if (msg.role === 'user') {
      out.push({ type: 'message', role: 'user', content: userContent(msg.content, model, ctx, where) });
    } else if (msg.role === 'assistant') {
      // Parte reasoning é ignorada de propósito: este fio não tem onde guardá-la, e o raciocínio de outro
      // provedor (assinado pela Anthropic, por exemplo) não pode quebrar o fallback.
      const text = textOnly(msg.content, 'assistant', ctx, where, true);
      const calls = msg.toolCalls ?? [];
      if (!Array.isArray(calls)) throw invalid(`${where}: toolCalls precisa ser uma lista`, ctx);
      // Turno vazio não diz nada ao modelo, e a Responses API aceita itens soltos: sem texto, não há message.
      if (text) out.push({ type: 'message', role: 'assistant', content: text });
      calls.forEach((call, k) => {
        const at = `${where}.toolCalls[${k}]`;
        if (!call || typeof call !== 'object') throw invalid(`${at}: tool_call malformado (esperado um objeto)`, ctx);
        if (typeof call.name !== 'string' || !call.name) throw invalid(`${at}: tool_call precisa de name`, ctx);
        if (typeof call.id !== 'string' || !call.id) throw invalid(`${at}: tool_call precisa de id`, ctx);
        out.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments || '{}' });
      });
    } else if (msg.role === 'tool') {
      if (!msg.toolCallId) throw invalid(`${where}: mensagem tool sem toolCallId`, ctx);
      const text = textOnly(msg.content, 'tool', ctx, where);
      out.push({ type: 'function_call_output', call_id: msg.toolCallId, output: msg.isError === true ? TOOL_ERROR_PREFIX + text : text });
    } else {
      throw invalid(`${where}: papel de mensagem desconhecido: ${String(/** @type {any} */ (msg).role)}`, ctx);
    }
  });
  return out;
}

/**
 * System como um texto só, sem separador: o chamador corta o system em offsets arbitrários, e um
 * '\n\n' inserido mudaria o texto e quebraria o prefixo do cache automático. Marca de cache não vai.
 * @param {import('../types.js').System|undefined} system
 */
function systemText(system) {
  if (system === undefined || system === '') return undefined;
  const text = typeof system === 'string' ? system : system.map((b) => b.text).join('');
  return text === '' ? undefined : text;
}

/**
 * Conteúdo do papel user: o texto simples fica string; com partes, a lista de `input_*`.
 * @param {string | Part[]} content @param {Model} model @param {Ctx} ctx @param {string} where
 */
function userContent(content, model, ctx, where) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw invalid(`${where}: content precisa ser string ou lista de partes`, ctx);
  return content.map((part, j) => {
    const at = `${where}.content[${j}]`;
    if (!part || typeof part !== 'object') throw invalid(`${at}: parte malformada (esperado um objeto)`, ctx);
    if (part.type === 'text') return { type: 'input_text', text: part.text };
    if (part.type === 'audio' || part.type === 'video') {
      throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: a Responses API não lê ${part.type} (só texto, imagem e arquivo)`, ctx);
    }
    if (part.type !== 'image' && part.type !== 'file' && part.type !== 'reasoning') {
      throw invalid(`${at}: tipo de parte "${/** @type {any} */ (part).type}" desconhecido`, ctx);
    }
    assertMediaSupported(part, model, { provider: ctx.provider }); // reasoning cai aqui como invalid_request
    if (part.type === 'image') {
      return { type: 'input_image', image_url: part.data !== undefined ? asDataUrl(part.data, part.mime) : part.url };
    }
    if (part.type === 'file') {
      if (part.data === undefined) return { type: 'input_file', filename: part.name ?? defaultFilename(part.mime), file_url: part.url };
      const fileData = asDataUrl(part.data, part.mime);
      return { type: 'input_file', filename: part.name ?? defaultFilename(part.mime ?? parseDataUrl(fileData)?.mime), file_data: fileData };
    }
    throw invalid(`${at}: parte reasoning só existe no papel assistant`, ctx);
  });
}

/** @param {string} data @param {string|undefined} mime */
const asDataUrl = (data, mime) => (data.startsWith('data:') ? data : `data:${mime};base64,${data}`);

/**
 * Papéis assistant e tool levam texto; mídia ali não tem formato neste fio. `skipReasoning` descarta as
 * partes reasoning (só o papel assistant as tem).
 * @param {string | Part[]} content @param {string} role @param {Ctx} ctx @param {string} where @param {boolean} [skipReasoning]
 */
function textOnly(content, role, ctx, where, skipReasoning = false) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw invalid(`${where}: content do papel ${role} precisa ser string ou lista de partes`, ctx);
  let text = '';
  for (const p of content) {
    if (skipReasoning && p?.type === 'reasoning') continue;
    if (!p || p.type !== 'text') {
      throw unsupported(`${ctx.provider}/${ctx.model}: ${where}: parte ${p?.type} no papel ${role} não é suportada (mídia só em mensagens user)`, ctx);
    }
    text += p.text;
  }
  return text;
}

/** @param {string} message @param {Ctx} ctx */
function invalid(message, ctx) {
  return new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, message: `${ctx.provider}/${ctx.model}: ${message}` });
}

// ---------------------------------------------------------------------------------------
// stream

/** Status HTTP do `code` textual de um erro da Responses API; o que não conhecemos é 500 (`upstream`). */
const STATUS_BY_CODE = Object.freeze({
  invalid_api_key: 401, authentication_error: 401, permission_denied: 403,
  rate_limit_exceeded: 429, insufficient_quota: 429, rate_limit_error: 429,
  invalid_request_error: 400, invalid_prompt: 400, context_length_exceeded: 400, invalid_image: 400, invalid_value: 400,
  model_not_found: 404, server_error: 500,
});

/** @param {any} error @returns {number} */
function statusOfError(error) {
  const code = error?.code;
  const n = typeof code === 'string' && /^\d+$/.test(code) ? Number(code) : code;
  if (typeof n === 'number' && Number.isInteger(n) && n >= 100 && n <= 599) return n;
  const table = /** @type {Record<string, number>} */ (STATUS_BY_CODE);
  return table[String(code)] ?? table[String(error?.type)] ?? 500;
}

/**
 * `usage` da Responses API → Usage. `input_tokens` inclui o cache lido; `output_tokens` inclui o raciocínio.
 * @param {any} u @returns {import('../types.js').Usage}
 */
function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return makeUsage({ raw: null });
  const cacheRead = num(u.input_tokens_details?.cached_tokens);
  const cacheWrite = num(u.input_tokens_details?.cache_write_tokens);
  const reasoning = u.output_tokens_details?.reasoning_tokens;
  return makeUsage({
    input: Math.max(0, num(u.input_tokens) - cacheRead - cacheWrite),
    output: num(u.output_tokens),
    cacheRead,
    cacheWrite,
    ...(typeof reasoning === 'number' && Number.isFinite(reasoning) ? { reasoning } : {}),
    raw: u,
  });
}

/**
 * `incomplete_details.reason` → vocabulário da lib. Razão que não conhecemos passa como veio.
 * @param {unknown} reason
 */
function incompleteReason(reason) {
  if (reason === 'max_output_tokens') return 'length';
  if (typeof reason === 'string' && reason) return reason;
  return 'incomplete';
}

// ---------------------------------------------------------------------------------------
// registro de tool calls
//
// Servidor que copia o formato troca de identificador entre eventos (`id`, `call_id`, `item_id`
// do delta, `output_index`), e alguns eventos vêm sem nenhum. Por isso cada chamada tem UM registro,
// achado por qualquer apelido que o evento traga; apelidos novos são registrados, e dois registros
// que um evento prove serem a mesma chamada se fundem. Cada registro sai uma vez (`emitted`).

/**
 * @typedef {object} CallRecord
 * @property {number} n  ordem de criação
 * @property {Set<string>} keys  apelidos: id, call_id, item_id e `#output_index`
 * @property {string} callId @property {string} itemId @property {string} name
 * @property {string} args  acumulado dos deltas
 * @property {string} itemArgs  `arguments` de um item (done ou final); vence o acumulado
 * @property {boolean} closed  recebeu `output_item.done`
 * @property {boolean} inFinal  casou com um item de `response.output`
 * @property {boolean} emitted
 */

/** `arguments` como texto: objeto vira JSON; o que não é texto nem objeto é vazio. @param {unknown} v */
function argsText(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') { try { return JSON.stringify(v); } catch { return ''; } }
  return '';
}

/** @param {string} text */
function validJson(text) {
  try { JSON.parse(text); return true; } catch { return false; }
}

/** Forma comparável de dois `arguments`: JSON equivalente é igual, mesmo com espaços diferentes. @param {string} text */
function canonical(text) {
  try { return JSON.stringify(JSON.parse(text)); } catch { return text.trim(); }
}

/** Apelidos de um evento ou item: ids como texto, índice como `#n`. @param {...unknown} values */
function aliasesOf(...values) {
  /** @type {string[]} */
  const out = [];
  for (const v of values) if (typeof v === 'string' && v) out.push(v);
  return out;
}

/** @param {unknown} index */
const indexKey = (index) => (Number.isInteger(index) ? [`#${index}`] : []);

function createCallRegistry() {
  /** @type {CallRecord[]} */
  const all = [];
  /** Apelidos que um evento provou (o registro foi achado por outro apelido, ou nasceu com ele). @type {Map<string, CallRecord>} */
  const strong = new Map();
  /** Apelidos que só um palpite por posição ligou ao registro: valem se nada mais forte aparecer. @type {Map<string, CallRecord>} */
  const weak = new Map();
  let serial = 0;

  /** @param {CallRecord} rec @param {string[]} keys @param {boolean} [guess] */
  const bind = (rec, keys, guess = false) => {
    for (const k of keys) {
      rec.keys.add(k);
      if (!guess) strong.set(k, rec);
      else if (!strong.has(k) && !weak.has(k)) weak.set(k, rec);
    }
  };

  /** @param {CallRecord} into @param {CallRecord} from */
  const merge = (into, from) => {
    for (const map of [strong, weak]) for (const [k, r] of map) if (r === from) map.set(k, into);
    for (const k of from.keys) into.keys.add(k);
    into.callId ||= from.callId;
    into.itemId ||= from.itemId;
    into.name ||= from.name;
    into.args ||= from.args;
    into.itemArgs ||= from.itemArgs;
    into.closed ||= from.closed;
    into.inFinal ||= from.inFinal;
    into.emitted ||= from.emitted;
    all.splice(all.indexOf(from), 1);
  };

  /** @param {string[]} keys @returns {CallRecord} */
  const create = (keys) => {
    /** @type {CallRecord} */
    const rec = { n: serial++, keys: new Set(), callId: '', itemId: '', name: '', args: '', itemArgs: '', closed: false, inFinal: false, emitted: false };
    all.push(rec);
    bind(rec, keys);
    return rec;
  };

  /** @param {Map<string, CallRecord>} map @param {string[]} keys */
  const hitsIn = (map, keys) => [...new Set(keys.map((k) => map.get(k)).filter(/** @returns {r is CallRecord} */ (r) => !!r))].sort((a, b) => a.n - b.n);

  /**
   * Registro de algum dos apelidos. Apelido provado vale mais que palpite; se os provados forem de registros
   * diferentes, o evento prova que são a mesma chamada, e funde.
   * @param {string[]} keys @returns {CallRecord|null}
   */
  const find = (keys) => {
    const proven = hitsIn(strong, keys);
    const hits = proven.length ? proven : hitsIn(weak, keys);
    if (!hits.length) return null;
    const [first, ...rest] = hits;
    for (const r of rest) merge(first, r);
    if (proven.length) bind(first, keys);
    return first;
  };

  /** Os `arguments` que valem para o registro: o item vence o acumulado. @param {CallRecord} rec */
  const argsOf = (rec) => rec.itemArgs || rec.args;

  /**
   * O registro e o item podem ser a mesma chamada? Nome e argumentos não se contradizem. O acumulado dos deltas pode
   * ser só um pedaço dos `arguments` do item.
   * @param {CallRecord} rec @param {any} item
   */
  const compatible = (rec, item) => {
    if (rec.name && typeof item.name === 'string' && item.name && rec.name !== item.name) return false;
    const full = argsText(item.arguments).trim();
    if (!full) return true;
    if (rec.itemArgs.trim()) return canonical(rec.itemArgs) === canonical(full);
    const part = rec.args.trim();
    return !part || canonical(part) === canonical(full) || full.includes(part);
  };

  /**
   * Entre os candidatos, primeiro o que tem nome e ainda não tem argumentos (é quem precisa do dado: duas chamadas
   * iguais não se confundem), depois o que tem nome (um fragmento órfão não tem). @param {(r: CallRecord) => boolean} ok
   */
  const firstNamed = (ok) => all.find((r) => r.name && !argsOf(r).trim() && ok(r)) ?? all.find((r) => r.name && ok(r));

  /**
   * Junta o que um item traz (added, done ou final) ao registro. O primeiro `call_id` e o primeiro nome vencem.
   * No `added` os argumentos são parciais (os deltas seguem), então entram no acumulado, não como item.
   * @param {CallRecord} rec @param {any} item @param {{ partial?: boolean }} [opts]
   */
  const absorb = (rec, item, { partial = false } = {}) => {
    if (typeof item.id === 'string' && item.id) rec.itemId ||= item.id;
    if (typeof item.call_id === 'string' && item.call_id) rec.callId ||= item.call_id;
    if (typeof item.name === 'string' && item.name) rec.name ||= item.name;
    const text = argsText(item.arguments);
    if (!text.trim() || rec.emitted) return;
    if (partial) rec.args ||= text;
    else rec.itemArgs = text;
  };

  /**
   * Funde os `function_call` de `response.output` nos registros. Item com apelido conhecido casa por ele. O
   * que sobra (ids que mudaram, ou nenhum) casa por posição: o registro ainda não casado que não contradiz o
   * item; sem esse, é uma chamada que só o evento final conhece. Por fim, fragmento de argumentos sem dono
   * (delta com apelido desconhecido) vai para a chamada que o contém.
   * @param {any[]} items
   */
  const mergeFinal = (items) => {
    /** @type {any[]} */
    const loose = [];
    for (const item of items) {
      const keys = aliasesOf(item.id, item.call_id);
      const rec = keys.length ? find(keys) : null;
      if (rec) { absorb(rec, item); rec.inFinal = true; } else loose.push(item);
    }
    for (const item of loose) {
      const keys = aliasesOf(item.id, item.call_id);
      const rec = firstNamed((r) => !r.inFinal && compatible(r, item)) ?? all.find((r) => !r.inFinal && compatible(r, item)) ?? create([]);
      bind(rec, keys, true);
      absorb(rec, item);
      rec.inFinal = true;
    }
    for (const orphan of [...all]) {
      if (orphan.name || orphan.closed || orphan.inFinal || !orphan.args.trim()) continue;
      // O fragmento é de uma chamada com nome: sem argumentos ainda, ou com os argumentos inteiros que o contêm.
      const part = orphan.args.trim();
      const target = all.find((r) => r !== orphan && r.name && (!argsOf(r).trim() || canonical(argsOf(r)) === canonical(part) || argsOf(r).includes(part)));
      if (target) merge(target, orphan);
    }
  };

  return {
    all, absorb, argsOf, mergeFinal,
    /** Registro de um item `added` ou de um delta; senão cria. @param {string[]} keys */
    locate(keys) { return find(keys) ?? create(keys); },
    /**
     * `done`. Achado por apelido, é a chamada dele. Senão: com `output_index` o índice manda (é outra chamada); sem
     * ele, vale um palpite por posição — a primeira chamada ainda aberta que não contradiz o item (os `done`
     * chegam na ordem). Os apelidos novos entram como palpite, não como prova.
     * @param {string[]} keys @param {any} item @param {boolean} hasIndex
     */
    locateDone(keys, item, hasIndex) {
      const hit = find(keys);
      if (hit) return hit;
      if (!hasIndex) {
        const isOpen = (/** @type {CallRecord} */ r) => !r.closed && !r.emitted && compatible(r, item);
        const named = firstNamed(isOpen);
        if (named) { bind(named, keys, true); return named; }
        // Sem nenhum identificador, um `done` que cabe numa chamada já fechada do mesmo nome é o evento repetido.
        const again = !keys.length && all.find((r) => r.closed && r.name && r.name === item.name && compatible(r, item));
        if (again) return again;
        const any = all.find(isOpen); // fragmento órfão que o done completa
        if (any) { bind(any, keys, true); return any; }
      }
      return create(keys);
    },
    /** Delta sem nenhum apelido: vai para a chamada aberta mais recente. */
    latestOpen() { return [...all].reverse().find((r) => !r.closed && !r.emitted) ?? create([]); },
  };
}

/**
 * Lê os eventos SSE da Responses API e rende text/reasoning/tool_call; devolve o resumo no `return`.
 * O fim limpo é `response.completed` ou `response.incomplete`; stream sem eles foi cortado e dá `upstream`.
 * @type {ApiModule['parseStream']}
 */
export async function* parseStream(events, { account, model }) {
  let refused = false;
  /** @type {Ctx} */
  const ctx = { provider: account?.provider, model: model.id };
  const registry = createCallRegistry();
  let sawCall = false;
  let emitted = false;
  /** Saiu texto (delta ou recusa): o texto do evento final só entra quando nada disso saiu. */
  let textOut = false;
  let callCount = 0;
  /** @type {any} */ let final = null;
  /** @type {'completed'|'incomplete'|null} */ let kind = null;

  /** @param {string} message @param {unknown} [body] */
  const upstream = (message, body) => new ProviderError({ type: 'upstream', ...ctx, emitted, ...(body !== undefined ? { body } : {}), message: `${ctx.provider}/${ctx.model}: ${message}` });

  /**
   * Emite o registro, uma vez. Com JSON incompleto dá erro: emitir `arguments` inválido faria o chamador
   * executar a ferramenta com lixo.
   * @param {CallRecord} rec
   */
  const take = (rec) => {
    const raw = registry.argsOf(rec);
    const body = { id: rec.itemId, call_id: rec.callId, name: rec.name, arguments: raw };
    if (!rec.name) throw upstream('function_call sem nome no stream', body);
    const text = raw.trim() ? raw : '{}';
    if (!validJson(text)) throw upstream(`tool call cortada (${rec.name}, arguments não é JSON)`, body);
    rec.emitted = true;
    sawCall = true;
    emitted = true;
    const id = rec.callId || rec.itemId || `call_${callCount}`;
    callCount += 1;
    return /** @type {const} */ ({ type: 'tool_call', id, name: rec.name, arguments: text });
  };

  for await (const ev of events) {
    const data = ev.data.trim();
    if (data === '[DONE]') break;
    if (!data) continue;

    /** @type {any} */ let chunk;
    try { chunk = JSON.parse(data); } catch (cause) {
      throw new ProviderError({ type: 'upstream', ...ctx, body: data, cause, message: `${ctx.provider}/${ctx.model}: evento do stream não é JSON` });
    }
    const type = typeof chunk?.type === 'string' ? chunk.type : ev.event;

    switch (type) {
      case 'response.output_text.delta':
        if (typeof chunk.delta === 'string' && chunk.delta) { emitted = true; textOut = true; yield { type: 'text', text: chunk.delta }; }
        break;

      // O resumo do raciocínio (OpenAI) e o raciocínio bruto (modelos abertos, como o gpt-oss no llama.cpp).
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (typeof chunk.delta === 'string' && chunk.delta) { emitted = true; yield { type: 'reasoning', text: chunk.delta }; }
        break;

      case 'response.output_item.added':
        if (chunk.item?.type === 'function_call') {
          const rec = registry.locate([...aliasesOf(chunk.item.id, chunk.item.call_id), ...indexKey(chunk.output_index)]);
          registry.absorb(rec, chunk.item, { partial: true });
        }
        break;

      case 'response.function_call_arguments.delta': {
        if (typeof chunk.delta !== 'string' || !chunk.delta) break; // delta vazio não diz nada: não abre registro
        const keys = [...aliasesOf(chunk.item_id, chunk.call_id), ...indexKey(chunk.output_index)];
        const rec = keys.length ? registry.locate(keys) : registry.latestOpen();
        if (!rec.emitted) rec.args += chunk.delta;
        break;
      }

      case 'response.output_item.done':
        if (chunk.item?.type === 'function_call') {
          const index = indexKey(chunk.output_index);
          const rec = registry.locateDone([...aliasesOf(chunk.item.id, chunk.item.call_id), ...index], chunk.item, index.length > 0);
          registry.absorb(rec, chunk.item);
          rec.closed = true;
          // Sem argumento nenhum até aqui, só o evento final diz se foi corte ou ferramenta sem parâmetros.
          if (!rec.emitted && registry.argsOf(rec).trim()) yield take(rec);
        }
        break;

      // Recusa do modelo: o texto chega como resposta, e o fim diz que foi recusa.
      case 'response.refusal.delta':
        if (typeof chunk.delta === 'string' && chunk.delta) { emitted = true; refused = true; textOut = true; yield { type: 'text', text: chunk.delta }; }
        break;

      case 'response.completed':
        final = chunk.response ?? {};
        kind = 'completed';
        break;
      case 'response.incomplete':
        final = chunk.response ?? {};
        kind = 'incomplete';
        break;

      case 'response.failed':
        throw streamError(chunk.response?.error, chunk, ctx, emitted);
      case 'error':
        throw streamError(chunk?.error && typeof chunk.error === 'object' ? chunk.error : chunk, chunk, ctx, emitted);

      default:
        // response.created, in_progress, content_part.*, *.done… sem evento da lib.
        break;
    }
    if (kind) break;
  }

  if (!kind) {
    throw new ProviderError({ type: 'upstream', ...ctx, message: `${ctx.provider}/${ctx.model}: stream terminou sem evento final (response.completed, response.incomplete ou response.failed)` });
  }

  // O evento final traz tudo de novo: funde nos registros antes de emitir o que falta.
  const finalOutput = Array.isArray(final.output) ? final.output : [];
  registry.mergeFinal(finalOutput.filter((/** @type {any} */ item) => item?.type === 'function_call'));

  // Servidor que copia o formato pode não ter mandado o texto em delta: ele está no item final.
  if (!textOut) {
    for (const item of finalOutput) {
      for (const part of Array.isArray(item?.content) ? item.content : []) {
        if (part?.type !== 'refusal' && typeof part?.text === 'string' && part.text) {
          emitted = true;
          textOut = true;
          yield { type: 'text', text: part.text };
        }
      }
    }
  }
  // Recusa que só vem no item final, sem delta.
  if (!refused) {
    for (const item of finalOutput) {
      for (const part of Array.isArray(item?.content) ? item.content : []) {
        if (part?.type === 'refusal' && typeof part.refusal === 'string' && part.refusal) {
          refused = true;
          emitted = true;
          yield { type: 'text', text: part.refusal };
        }
      }
    }
  }

  // O que ainda não saiu, na ordem. Chamada sem argumento nenhum: cortada se a resposta foi cortada;
  // senão, é ferramenta sem parâmetros — desde que o stream a tenha fechado (done ou item final).
  for (const rec of [...registry.all]) {
    if (rec.emitted) continue;
    // Registro sem nome, sem argumentos e que nenhum evento fechou: sobra de um evento sem dado, não é chamada.
    if (!rec.name && !rec.closed && !rec.inFinal && !registry.argsOf(rec).trim()) continue;
    if (!registry.argsOf(rec).trim()) {
      if (kind === 'incomplete') throw upstream(`tool call cortada pelo limite, sem argumentos (${rec.name || 'sem nome'})`);
      if (!rec.closed && !rec.inFinal) throw upstream(`tool call sem fim no stream (${rec.name || 'sem nome'})`);
    }
    yield take(rec);
  }

  const finishReason = kind === 'incomplete'
    ? incompleteReason(final.incomplete_details?.reason)
    : sawCall ? 'tool_calls' : refused ? 'content_filter' : 'stop';
  return {
    finishReason,
    usage: normalizeUsage(final.usage),
    reportedCostUsd: reportedCost(final.usage?.cost),
  };
}

/**
 * Erro de `response.failed` ou `error`. Sem código nem tipo vira `upstream` (HTTP 500).
 * @param {any} error @param {any} chunk @param {Ctx} ctx @param {boolean} emitted
 */
function streamError(error, chunk, ctx, emitted) {
  const e = error && typeof error === 'object' ? error : {};
  return errorFromStatus(statusOfError(e), {
    ...ctx, body: chunk, emitted,
    message: typeof e.message === 'string' && e.message ? e.message : typeof error === 'string' ? error : undefined,
  });
}
