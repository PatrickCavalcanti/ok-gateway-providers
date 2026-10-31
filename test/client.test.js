// Cliente com um fio falso: fila, result, emitted, prazos, abort e erros HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, registerApi, listApis } from '../src/client.js';
import { ProviderError } from '../src/errors.js';

/** Fio falso: cada evento SSE `data: <texto>` vira um `text`; `data: !<status>` vira erro no stream. */
const fake = {
  api: 'fake',
  /** @param {any} args */
  buildRequest({ account, request, apiKey }) {
    return { url: `${account.baseUrl}/x`, headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: { n: request.messages.length } };
  },
  /** @param {AsyncIterable<{data: string}>} events */
  async *parseStream(events) {
    for await (const ev of events) {
      if (ev.data.startsWith('!')) {
        const { errorFromStatus } = await import('../src/errors.js');
        throw errorFromStatus(Number(ev.data.slice(1)), { provider: 'fake', model: 'm' });
      }
      yield { type: /** @type {const} */ ('text'), text: ev.data };
    }
    return { finishReason: 'stop', usage: { input: 1000, output: 2000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, raw: null }, reportedCostUsd: null };
  },
};
registerApi(/** @type {any} */ (fake));

const account = /** @type {any} */ ({ id: 'a', provider: 'fake', api: 'fake', baseUrl: 'http://h', apiKey: 'k1', headers: { 'x-conta': '1', authorization: 'não vence' } });
const model = /** @type {any} */ ({ id: 'm', operations: ['chat'], input: ['text'], output: ['text'], cost: { input: 1, output: 2 } });
const msgs = [{ role: /** @type {const} */ ('user'), content: 'oi' }];

/** @param {string[]} chunks @param {{ hang?: boolean, gapMs?: number }} [o] */
function sse(chunks, o = {}) {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(c) {
      for (const ch of chunks) { if (o.gapMs) await sleep(o.gapMs); c.enqueue(enc.encode(ch)); }
      if (!o.hang) c.close();
    },
  });
}

/** fetch falso que respeita o signal. @param {(init: any) => Response | Promise<Response>} make */
function fakeFetch(make) {
  /** @type {any[]} */ const calls = [];
  const f = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, init });
    if (init.signal?.aborted) throw init.signal.reason;
    const res = await make(init);
    return res;
  });
  f.calls = calls;
  return f;
}

/** @param {AsyncIterable<any>} run */
async function collect(run) { const out = []; for await (const ev of run) out.push(ev); return out; }

test('eventos na ordem, end com custo da tabela, result igual ao end', async () => {
  const f = fakeFetch(() => new Response(sse(['data: a\n\n', 'data: b\n\n'])));
  const run = createClient({ account, model, fetch: f }).chat({ messages: msgs });
  const evs = await collect(run);
  assert.deepEqual(evs.slice(0, 2), [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]);
  assert.equal(evs[2].type, 'end');
  assert.deepEqual(evs[2].cost, { usd: 0.005, source: 'table' });
  const r = await run.result;
  assert.equal(r.finishReason, 'stop');
  assert.deepEqual(r.cost, evs[2].cost);
  // headers: o do fio vence a conta, a conta entra
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer k1');
  assert.equal(f.calls[0].init.headers['x-conta'], '1');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { n: 1 });
});

test('result funciona sem iterar', async () => {
  const f = fakeFetch(() => new Response(sse(['data: a\n\n'])));
  const r = await createClient({ account, model, fetch: f }).chat({ messages: msgs }).result;
  assert.equal(r.usage.output, 2000);
});

test('apiKey função é chamada a cada pedido', async () => {
  let n = 0;
  const acc = { ...account, apiKey: async () => `tok${++n}` };
  const f = fakeFetch(() => new Response(sse(['data: a\n\n'])));
  const client = createClient({ account: acc, model, fetch: f });
  await client.chat({ messages: msgs }).result;
  await client.chat({ messages: msgs }).result;
  assert.deepEqual(f.calls.map((/** @type {any} */ c) => c.init.headers.authorization), ['Bearer tok1', 'Bearer tok2']);
});

test('modelo sem chat dá unsupported antes do fetch', async () => {
  const f = fakeFetch(() => new Response(sse([])));
  const run = createClient({ account, model: { ...model, operations: ['speech'] }, fetch: f }).chat({ messages: msgs });
  await assert.rejects(run.result, (e) => e instanceof ProviderError && e.type === 'unsupported' && e.retryOther && !e.emitted);
  await assert.rejects(collect(run), (e) => e instanceof ProviderError && e.type === 'unsupported');
  assert.equal(f.calls.length, 0);
});

test('fio desconhecido dá unsupported', async () => {
  const f = fakeFetch(() => new Response(sse([])));
  const run = createClient({ account: { ...account, api: 'nao-existe' }, model, fetch: f }).chat({ messages: msgs });
  await assert.rejects(run.result, (e) => e instanceof ProviderError && e.type === 'unsupported');
  assert.equal(f.calls.length, 0);
  assert.ok(listApis().includes('fake'));
});

test('HTTP 401, 429 e 500 viram erro tipado com corpo', async () => {
  for (const [status, type] of /** @type {const} */ ([[401, 'auth'], [429, 'rate_limit'], [500, 'upstream'], [400, 'invalid_request']])) {
    const f = fakeFetch(() => new Response('{"error":{"message":"nao"}}', { status }));
    const run = createClient({ account, model, fetch: f }).chat({ messages: msgs });
    await assert.rejects(run.result, (e) => e instanceof ProviderError && e.type === type && e.status === status && e.retryOther && !e.emitted && /nao/.test(String(e.body)));
  }
});

test('falha de rede é upstream', async () => {
  const f = fakeFetch(() => { throw new TypeError('fetch failed'); });
  const run = createClient({ account, model, fetch: f }).chat({ messages: msgs });
  await assert.rejects(run.result, (e) => e instanceof ProviderError && e.type === 'upstream' && /fetch failed/.test(e.message));
});

test('erro no meio do stream marca emitted', async () => {
  const f = fakeFetch(() => new Response(sse(['data: a\n\n', 'data: !503\n\n'])));
  const run = createClient({ account, model, fetch: f }).chat({ messages: msgs });
  const got = [];
  await assert.rejects(async () => { for await (const ev of run) got.push(ev); }, (e) => e instanceof ProviderError && e.type === 'upstream' && e.emitted === true);
  assert.deepEqual(got, [{ type: 'text', text: 'a' }]);
  await assert.rejects(run.result, (e) => e instanceof ProviderError && e.emitted === true);
});

test('erro antes de qualquer evento não marca emitted', async () => {
  const f = fakeFetch(() => new Response(sse(['data: !429\n\n'])));
  const run = createClient({ account, model, fetch: f }).chat({ messages: msgs });
  await assert.rejects(run.result, (e) => e instanceof ProviderError && e.type === 'rate_limit' && e.emitted === false);
});

/** Corpo que só termina quando o signal aborta (como o fetch de verdade). @param {any} init @param {string[]} chunks */
function hangingBody(init, chunks = []) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      init.signal.addEventListener('abort', () => c.error(init.signal.reason), { once: true });
    },
  });
}

test('timeout de primeiro byte', async () => {
  const f = fakeFetch((init) => new Response(hangingBody(init)));
  const acc = { ...account, timeouts: { firstByteMs: 30, idleMs: 1000 } };
  const run = createClient({ account: acc, model, fetch: f }).chat({ messages: msgs });
  await assert.rejects(run.result, (e) => e instanceof ProviderError && e.type === 'timeout' && /primeiro byte/.test(e.message) && e.retryOther && !e.emitted);
});

test('timeout de inatividade depois de um evento marca emitted', async () => {
  const f = fakeFetch((init) => new Response(hangingBody(init, ['data: a\n\n'])));
  const acc = { ...account, timeouts: { firstByteMs: 1000, idleMs: 30 } };
  const run = createClient({ account: acc, model, fetch: f }).chat({ messages: msgs });
  await assert.rejects(run.result, (e) => e instanceof ProviderError && e.type === 'timeout' && /inatividade/.test(e.message) && e.emitted === true);
});

test('abort do chamador: aborted, retryOther false', async () => {
  const c = new AbortController();
  const f = fakeFetch((init) => new Response(hangingBody(init, ['data: a\n\n'])));
  const run = createClient({ account, model, fetch: f }).chat({ messages: msgs, signal: c.signal });
  setTimeout(() => c.abort(), 20);
  await assert.rejects(run.result, (e) => e instanceof ProviderError && e.type === 'aborted' && e.retryOther === false);
});

test('signal já abortado não chama o fetch', async () => {
  const c = new AbortController(); c.abort();
  const f = fakeFetch(() => new Response(sse([])));
  const run = createClient({ account, model, fetch: f }).chat({ messages: msgs, signal: c.signal });
  await assert.rejects(run.result, (e) => e instanceof ProviderError && e.type === 'aborted');
});

test('sair do for await cancela o pedido', async () => {
  let aborted = false;
  const f = fakeFetch((init) => {
    init.signal.addEventListener('abort', () => { aborted = true; });
    return new Response(hangingBody(init, ['data: a\n\n']));
  });
  const run = createClient({ account, model, fetch: f }).chat({ messages: msgs });
  for await (const ev of run) { assert.equal(ev.type, 'text'); break; }
  await assert.rejects(run.result, (e) => e instanceof ProviderError && e.type === 'aborted');
  assert.equal(aborted, true);
});

test('createClient exige conta e modelo', () => {
  assert.throws(() => createClient(/** @type {any} */ ({ model })), TypeError);
  assert.throws(() => createClient(/** @type {any} */ ({ account })), TypeError);
});
