// Operações de chamada única no cliente: runOperation com um fio falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, registerApi } from '../src/client.js';
import { ProviderError } from '../src/errors.js';
import { makeUsage } from '../src/usage.js';

/** Guarda o FormData que o fio montou e o ctx que o parseStream recebeu. */
const seen = { form: /** @type {FormData|null} */ (null), streamCtx: /** @type {any} */ (null) };

const fakeOps = {
  api: 'fake-ops',
  buildRequest() { return { url: 'http://h/chat', headers: {}, body: {} }; },
  /** @param {AsyncIterable<{data: string}>} events @param {any} ctx */
  async *parseStream(events, ctx) {
    seen.streamCtx = ctx;
    for await (const ev of events) yield { type: /** @type {const} */ ('text'), text: ev.data };
    return { finishReason: 'stop', usage: makeUsage({ input: 1 }), reportedCostUsd: null };
  },
  operations: {
    embeddings: {
      /** @param {any} args */
      buildRequest({ account, request, apiKey }) {
        if (request.mode === 'form') {
          seen.form = new FormData();
          seen.form.append('x', 'y');
          return { url: `${account.baseUrl}/emb`, headers: { authorization: `Bearer ${apiKey}` }, body: seen.form };
        }
        return { url: `${account.baseUrl}/emb`, headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: { n: 1 } };
      },
      /** @param {any} res @param {any} ctx */
      async parseResponse(res, ctx) {
        if (ctx.request.mode === 'boom') throw new Error('quebrou ao ler');
        if (ctx.request.mode === 'typed') throw new ProviderError({ type: 'invalid_request', retryOther: false, message: 'tipado' });
        await res.json();
        return { result: { vectors: [[1]] }, usage: makeUsage({ input: 2 }), reportedCostUsd: null };
      },
    },
  },
};
registerApi(/** @type {any} */ (fakeOps));
registerApi(/** @type {any} */ ({ api: 'fake-noops', buildRequest: fakeOps.buildRequest, parseStream: fakeOps.parseStream }));

const account = /** @type {any} */ ({ id: 'a', provider: 'fake', api: 'fake-ops', baseUrl: 'http://h', apiKey: 'k1' });
const model = /** @type {any} */ ({ id: 'm', operations: ['chat', 'embeddings'], input: ['text'], output: ['embeddings'], cost: { input: 1, output: 1 } });
const json = (/** @type {unknown} */ v, /** @type {number} */ status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', 'x-eco': 'oi' } });

/** fetch falso que respeita o signal. @param {(init: any) => Response | Promise<Response>} make */
function fakeFetch(make) {
  /** @type {any[]} */ const calls = [];
  const f = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, init });
    if (init.signal?.aborted) throw init.signal.reason;
    return make(init);
  });
  f.calls = calls;
  return f;
}

/** Promessa que só acaba quando o signal aborta (servidor que não responde). @param {any} init @returns {Promise<Response>} */
const silent = (init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason), { once: true }));

/** Corpo que para no meio e só termina quando o signal aborta. @param {any} init @param {string[]} chunks */
function hangingBody(init, chunks = []) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      init.signal.addEventListener('abort', () => c.error(init.signal.reason), { once: true });
    },
  });
}

const isErr = (/** @type {string} */ type, /** @type {Record<string, unknown>} */ extra = {}) => (/** @type {any} */ e) =>
  e instanceof ProviderError && e.type === type && Object.entries(extra).every(([k, v]) => e[k] === v);

test('sucesso: resultado, uso e custo da tabela', async () => {
  const f = fakeFetch(() => json({ ok: 1 }));
  const out = await createClient({ account, model, fetch: f }).embed({ texts: ['a'] });
  assert.deepEqual(out.vectors, [[1]]);
  assert.equal(out.usage.input, 2);
  assert.deepEqual(out.cost, { usd: 0.000002, source: 'table' });
  assert.equal(f.calls[0].url, 'http://h/emb');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer k1');
  assert.equal(f.calls[0].init.body, '{"n":1}');
});

test('modelo sem a operação: unsupported, sem fetch', async () => {
  const f = fakeFetch(() => json({}));
  const m = { ...model, operations: ['chat'] };
  await assert.rejects(createClient({ account, model: m, fetch: f }).embed({ texts: ['a'] }), isErr('unsupported'));
  assert.equal(f.calls.length, 0);
});

test('fio sem a operação: unsupported, sem fetch', async () => {
  const f = fakeFetch(() => json({}));
  await assert.rejects(createClient({ account: { ...account, api: 'fake-noops' }, model, fetch: f }).embed({ texts: ['a'] }), isErr('unsupported'));
  assert.equal(f.calls.length, 0);
});

test('FormData segue como está e o content-type fica para o fetch', async () => {
  const f = fakeFetch(() => json({}));
  await createClient({ account, model, fetch: f }).embed({ mode: 'form' });
  assert.ok(seen.form instanceof FormData);
  assert.equal(f.calls[0].init.body, seen.form);
  assert.equal(Object.keys(f.calls[0].init.headers).some((k) => k.toLowerCase() === 'content-type'), false);
});

test('status 429: rate_limit, emitted false', async () => {
  const f = fakeFetch(() => json({ error: { message: 'devagar' } }, 429));
  await assert.rejects(createClient({ account, model, fetch: f }).embed({}), isErr('rate_limit', { emitted: false }));
});

test('corpo que não é JSON: upstream', async () => {
  const f = fakeFetch(() => new Response('não é json', { status: 200 }));
  await assert.rejects(createClient({ account, model, fetch: f }).embed({}), isErr('upstream', { emitted: false }));
});

test('apiKey que lança: auth, sem fetch', async () => {
  const f = fakeFetch(() => json({}));
  const acc = { ...account, apiKey: () => { throw new Error('sem token'); } };
  await assert.rejects(createClient({ account: acc, model, fetch: f }).embed({}), isErr('auth'));
  assert.equal(f.calls.length, 0);
});

test('timeout de primeiro byte por pedido', async () => {
  const f = fakeFetch(silent);
  await assert.rejects(
    createClient({ account, model, fetch: f }).embed({ timeouts: { firstByteMs: 20 } }),
    (e) => isErr('timeout', { emitted: false })(e) && /primeiro byte/.test(e.message),
  );
});

test('request.timeouts vence account.timeouts', async () => {
  const f = fakeFetch(silent);
  const acc = { ...account, timeouts: { firstByteMs: 10_000 } };
  const t0 = Date.now();
  await assert.rejects(createClient({ account: acc, model, fetch: f }).embed({ timeouts: { firstByteMs: 20 } }), isErr('timeout'));
  assert.ok(Date.now() - t0 < 2000, 'estourou no prazo do pedido, não no da conta');
});

test('timeout de inatividade com o corpo parado no meio', async () => {
  const f = fakeFetch((init) => new Response(hangingBody(init, ['{"a":'])));
  await assert.rejects(
    createClient({ account, model, fetch: f }).embed({ timeouts: { firstByteMs: 1000, idleMs: 20 } }),
    (e) => isErr('timeout')(e) && /inatividade/.test(e.message),
  );
});

test('signal abortado: aborted, retryOther false', async () => {
  const c = new AbortController();
  const f = fakeFetch(silent);
  const p = createClient({ account, model, fetch: f }).embed({ signal: c.signal });
  setTimeout(() => c.abort(), 20);
  await assert.rejects(p, isErr('aborted', { retryOther: false }));
});

test('parseResponse que lança Error comum: upstream, retryOther true', async () => {
  const f = fakeFetch(() => json({}));
  await assert.rejects(createClient({ account, model, fetch: f }).embed({ mode: 'boom' }), isErr('upstream', { retryOther: true, emitted: false }));
});

test('parseResponse que lança ProviderError passa como veio', async () => {
  const f = fakeFetch(() => json({}));
  await assert.rejects(createClient({ account, model, fetch: f }).embed({ mode: 'typed' }), isErr('invalid_request', { retryOther: false }));
});

test('createClient expõe os cinco métodos novos', () => {
  const c = createClient({ account, model, fetch: fakeFetch(() => json({})) });
  for (const k of ['embed', 'transcribe', 'speak', 'generateImage', 'decide']) assert.equal(typeof (/** @type {any} */ (c))[k], 'function');
});

test('chat: parseStream recebe os headers da resposta', async () => {
  const f = fakeFetch(() => new Response(new Blob(['data: a\n\n']).stream(), { headers: { 'x-eco': 'oi' } }));
  const run = createClient({ account, model, fetch: f }).chat({ messages: [{ role: 'user', content: 'oi' }] });
  await run.result;
  assert.equal(seen.streamCtx.headers.get('x-eco'), 'oi');
});

test('json() e bytes() dividem a mesma leitura do corpo', async () => {
  registerApi({ api: 'fake-memo', buildRequest() { throw new Error('não usado'); }, async *parseStream() { return { finishReason: 'stop', usage: makeUsage() }; },
    operations: { embeddings: {
      buildRequest: () => ({ url: 'https://x/e', headers: {}, body: {} }),
      async parseResponse(res) { const a = await res.bytes(); const j = await res.json(); return { result: { n: a.length, j }, usage: makeUsage({ input: 1 }) }; },
    } } });
  const client = createClient({ account: { id: 'a', provider: 'p', api: 'fake-memo', baseUrl: 'https://x', apiKey: 'k' }, model: { id: 'm', operations: ['embeddings'], input: ['text'], output: ['embeddings'] }, fetch: async () => new Response('{"ok":1}') });
  const r = await client.embed({ texts: ['t'] });
  assert.deepEqual(r.j, { ok: 1 });
  assert.equal(r.n, 8);
});
