import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient, registerApi } from '../src/client.js';
import { ProviderError } from '../src/errors.js';
import * as openaiCompletions from '../src/apis/openai-completions.js';

registerApi(openaiCompletions);

const fixture = (name) => readFileSync(new URL(`./fixtures/openai-completions/${name}`, import.meta.url), 'utf8');

const account = (extra = {}) => ({
  id: 'or', provider: 'openrouter', api: 'openai-completions',
  baseUrl: 'https://or.test/api/v1/', apiKey: 'sk-test', ...extra,
});
const model = (extra = {}) => ({ id: 'inception/mercury', operations: ['chat'], input: ['text'], output: ['text'], ...extra });

/**
 * fetch falso: devolve o texto SSE de uma vez. `stall: true` deixa o stream aberto (sem fechar)
 * e erra com o motivo do abort, como o fetch real faz.
 */
function fakeFetch({ sse = '', status = 200, stall = false, first = true } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    if (status !== 200) return new Response(sse, { status });
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        if (first && sse) controller.enqueue(enc.encode(sse));
        if (!stall) controller.close();
        init?.signal?.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  fn.calls = calls;
  return fn;
}

async function collect(run) {
  const events = [];
  for await (const ev of run) events.push(ev);
  return events;
}

async function failure(run) {
  try { await collect(run); } catch (e) { return e; }
  assert.fail('esperava erro');
}

const hello = { messages: [{ role: 'user', content: 'oi' }] };

test('texto simples: eventos, uso sem o cache lido e custo do provedor', async () => {
  const f = fakeFetch({ sse: fixture('text.sse') });
  const client = createClient({ account: account(), model: model({ cost: { input: 1, output: 1 } }), fetch: f });
  const run = client.chat(hello);
  const events = await collect(run);

  assert.deepEqual(events.slice(0, 2), [{ type: 'text', text: 'Olá' }, { type: 'text', text: ', mundo!' }]);
  const end = events.at(-1);
  assert.equal(end.type, 'end');
  assert.equal(end.finishReason, 'stop');
  assert.equal(end.usage.input, 20); // 120 - 100 em cache
  assert.equal(end.usage.cacheRead, 100);
  assert.equal(end.usage.output, 6);
  assert.equal(end.usage.cacheWrite1h, 0);
  assert.equal(end.usage.raw.cost, 0.0000451);
  assert.deepEqual(end.cost, { usd: 0.0000451, source: 'provider' }); // vence a tabela
  assert.deepEqual((await run.result).cost, end.cost);
});

test('o pedido sai para /chat/completions com os headers do fio', async () => {
  const f = fakeFetch({ sse: fixture('text.sse') });
  const client = createClient({ account: account(), model: model(), fetch: f });
  await collect(client.chat(hello));
  const [call] = f.calls;
  assert.equal(call.url, 'https://or.test/api/v1/chat/completions');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer sk-test');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.equal(call.init.headers.Accept, 'text/event-stream');
  assert.equal(call.body.stream, true);
  assert.deepEqual(call.body.messages, [{ role: 'user', content: 'oi' }]);
});

test('custo pela tabela quando o provedor não informa', async () => {
  const f = fakeFetch({ sse: fixture('text-no-cost.sse') });
  const client = createClient({ account: account(), model: model({ cost: { input: 2, output: 4 } }), fetch: f });
  const run = client.chat(hello);
  const events = await collect(run);
  const end = events.at(-1);
  assert.equal(end.finishReason, 'length');
  assert.equal(end.usage.input, 1_000_000);
  assert.deepEqual(end.cost, { usd: 4, source: 'table' }); // 1M×2 + 0,5M×4
});

test('sem tabela e sem custo do provedor: usd null, nunca inventado', async () => {
  const f = fakeFetch({ sse: fixture('text-no-cost.sse') });
  const client = createClient({ account: account(), model: model(), fetch: f });
  const { cost } = await client.chat(hello).result;
  assert.deepEqual(cost, { usd: null, source: 'none' });
});

test('tool call fragmentada: acumulada por index e emitida completa no fim', async () => {
  const f = fakeFetch({ sse: fixture('tool-call.sse') });
  const client = createClient({ account: account(), model: model(), fetch: f });
  const events = await collect(client.chat({
    messages: [{ role: 'user', content: 'clima?' }],
    tools: [{ name: 'get_weather', description: 'Clima', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
  }));
  const calls = events.filter((e) => e.type === 'tool_call');
  assert.deepEqual(calls, [
    { type: 'tool_call', id: 'call_abc', name: 'get_weather', arguments: '{"city":"Campo Grande"}' },
    { type: 'tool_call', id: 'call_def', name: 'get_time', arguments: '{"tz":"UTC"}' },
  ]);
  assert.equal(JSON.parse(calls[0].arguments).city, 'Campo Grande');
  assert.equal(events.at(-1).finishReason, 'tool_calls');
  assert.equal(events.indexOf(calls[1]) < events.length - 1, true); // antes do `end`
  assert.deepEqual(f.calls[0].body.tools[0], {
    type: 'function',
    function: { name: 'get_weather', description: 'Clima', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
  });
});

test('raciocínio: reasoning e reasoning_content viram eventos reasoning; tokens de raciocínio no uso', async () => {
  const f = fakeFetch({ sse: fixture('reasoning.sse') });
  const client = createClient({ account: account(), model: model({ reasoning: true }), fetch: f });
  const events = await collect(client.chat(hello));
  assert.deepEqual(events.filter((e) => e.type === 'reasoning').map((e) => e.text), ['Preciso somar', ' 2 e 2.', ' Conferindo.']);
  assert.deepEqual(events.filter((e) => e.type === 'text'), [{ type: 'text', text: '4' }]);
  const end = events.at(-1);
  assert.equal(end.usage.reasoning, 30);
  assert.equal(end.usage.output, 35);
  assert.equal(end.cost.source, 'provider');
});

test('saída estruturada: schema vai em response_format e a resposta chega como texto', async () => {
  const f = fakeFetch({ sse: fixture('json-answer.sse') });
  const schema = { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] };
  const client = createClient({
    account: account({ compat: { structuredOutput: 'response_format' } }), model: model(), fetch: f,
  });
  const events = await collect(client.chat({ ...hello, responseSchema: { schema } }));
  assert.deepEqual(f.calls[0].body.response_format, {
    type: 'json_schema', json_schema: { name: 'response', strict: true, schema },
  });
  const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
  assert.deepEqual(JSON.parse(text), { answer: 42 });
});

test('schema com structuredOutput none: unsupported ANTES do fetch (não ignora)', async () => {
  const f = fakeFetch({ sse: fixture('text.sse') });
  const client = createClient({ account: account(), model: model(), fetch: f });
  const err = await failure(client.chat({ ...hello, responseSchema: { schema: { type: 'object' } } }));
  assert.ok(err instanceof ProviderError);
  assert.equal(err.type, 'unsupported');
  assert.equal(err.retryOther, true);
  assert.equal(err.emitted, false);
  assert.equal(f.calls.length, 0);
});

const PNG = 'iVBORw0KGgo=';

test('imagem data-url e url chegam como image_url', async () => {
  const f = fakeFetch({ sse: fixture('text.sse') });
  const client = createClient({ account: account(), model: model({ input: ['text', 'image'] }), fetch: f });
  await collect(client.chat({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'o que é isto?' },
        { type: 'image', data: PNG, mime: 'image/png' },
        { type: 'image', url: 'https://img.test/a.jpg' },
      ],
    }],
  }));
  assert.deepEqual(f.calls[0].body.messages[0].content, [
    { type: 'text', text: 'o que é isto?' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
    { type: 'image_url', image_url: { url: 'https://img.test/a.jpg' } },
  ]);
});

test('mídia não suportada: unsupported sem chamar o fetch', async () => {
  const cases = [
    ['imagem num modelo só de texto', model(), { type: 'image', data: PNG, mime: 'image/png' }],
    ['URL num modelo só data-url', model({ input: ['text', 'image'], transport: { image: ['data-url'] } }), { type: 'image', url: 'https://img.test/a.jpg' }],
    ['áudio num modelo sem áudio', model({ input: ['text', 'image'] }), { type: 'audio', data: 'AAA', format: 'wav' }],
    ['áudio com transport null', model({ input: ['text', 'audio'], transport: { audio: null } }), { type: 'audio', data: 'AAA', format: 'wav' }],
    ['vídeo sem transport.video', model({ input: ['text', 'video'] }), { type: 'video', url: 'https://v.test/a.mp4', mime: 'video/mp4' }],
  ];
  for (const [label, m, part] of cases) {
    const f = fakeFetch({ sse: fixture('text.sse') });
    const client = createClient({ account: account(), model: m, fetch: f });
    const err = await failure(client.chat({ messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }, part] }] }));
    assert.equal(err.type, 'unsupported', label);
    assert.equal(err.retryOther, true, label);
    assert.equal(f.calls.length, 0, label);
  }
});

test('401, 429 e 500: tipo, retryOther e corpo', async () => {
  const cases = [
    [401, 'auth'],
    [429, 'rate_limit'],
    [500, 'upstream'],
  ];
  for (const [status, type] of cases) {
    const f = fakeFetch({ status, sse: JSON.stringify({ error: { message: `falha ${status}` } }) });
    const client = createClient({ account: account(), model: model(), fetch: f });
    const err = await failure(client.chat(hello));
    assert.equal(err.type, type);
    assert.equal(err.status, status);
    assert.equal(err.retryOther, true);
    assert.equal(err.emitted, false);
    assert.match(err.message, new RegExp(`falha ${status}`));
    assert.equal(err.provider, 'openrouter');
  }
});

test('erro no meio do stream: emitted true, tipo pelo código do corpo, result rejeita igual', async () => {
  const f = fakeFetch({ sse: fixture('mid-stream-error.sse') });
  const client = createClient({ account: account(), model: model(), fetch: f });
  const run = client.chat(hello);
  const seen = [];
  let err;
  try { for await (const ev of run) seen.push(ev); } catch (e) { err = e; }
  assert.deepEqual(seen, [{ type: 'text', text: 'Começo da resposta' }]);
  assert.ok(err instanceof ProviderError);
  assert.equal(err.type, 'upstream');
  assert.equal(err.status, 502);
  assert.equal(err.emitted, true);
  assert.equal(err.retryOther, true);
  assert.match(err.message, /Provider disconnected/);
  await assert.rejects(run.result, (e) => e === err);
});

test('timeout de primeiro byte', async () => {
  const f = fakeFetch({ stall: true, first: false });
  const client = createClient({ account: account({ timeouts: { firstByteMs: 30, idleMs: 1000 } }), model: model(), fetch: f });
  const err = await failure(client.chat(hello));
  assert.equal(err.type, 'timeout');
  assert.equal(err.retryOther, true);
  assert.equal(err.emitted, false);
  assert.match(err.message, /primeiro byte/);
});

test('timeout de inatividade depois de já ter saído texto', async () => {
  const partial = fixture('text.sse').split('\n\n').slice(0, 3).join('\n\n') + '\n\n';
  const f = fakeFetch({ sse: partial, stall: true });
  const client = createClient({ account: account({ timeouts: { firstByteMs: 1000, idleMs: 30 } }), model: model(), fetch: f });
  const run = client.chat(hello);
  const seen = [];
  let err;
  try { for await (const ev of run) seen.push(ev); } catch (e) { err = e; }
  assert.deepEqual(seen.map((e) => e.type), ['text']);
  assert.equal(err.type, 'timeout');
  assert.equal(err.emitted, true);
  assert.match(err.message, /inatividade/);
});

test('abort do chamador: aborted e retryOther false', async () => {
  const f = fakeFetch({ stall: true, first: false });
  const ac = new AbortController();
  const client = createClient({ account: account(), model: model(), fetch: f });
  const run = client.chat({ ...hello, signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  const err = await failure(run);
  assert.equal(err.type, 'aborted');
  assert.equal(err.retryOther, false);
  await assert.rejects(run.result, (e) => e.type === 'aborted');
});

test('stream cortado sem finish_reason nem [DONE] não vira fim limpo', async () => {
  const cut = fixture('text.sse').split('\n\n').slice(0, 3).join('\n\n') + '\n\n';
  const f = fakeFetch({ sse: cut });
  const client = createClient({ account: account(), model: model(), fetch: f });
  const err = await failure(client.chat(hello));
  assert.equal(err.type, 'upstream');
  assert.equal(err.emitted, true);
  assert.match(err.message, /finish_reason/);
});

test('chunk que não é JSON vira erro upstream, não é engolido', async () => {
  const f = fakeFetch({ sse: 'data: {quebrado\n\n' });
  const client = createClient({ account: account(), model: model(), fetch: f });
  const err = await failure(client.chat(hello));
  assert.equal(err.type, 'upstream');
  assert.equal(err.body, '{quebrado');
});
