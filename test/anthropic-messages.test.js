// Fio anthropic-messages de ponta a ponta: createClient + fetch falso + fixtures SSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient, registerApi } from '../src/client.js';
import * as anthropic from '../src/apis/anthropic-messages.js';

registerApi(anthropic);

const fixture = (name) => readFileSync(new URL(`./fixtures/anthropic-messages/${name}`, import.meta.url), 'utf8');

const account = {
  id: 'anthropic-1',
  provider: 'anthropic',
  api: 'anthropic-messages',
  baseUrl: 'https://api.anthropic.com/v1/',
  apiKey: 'sk-teste',
};
const baseModel = {
  id: 'claude-haiku-4-5',
  operations: ['chat'],
  input: ['text', 'image'],
  output: ['text'],
};
const userHi = { messages: [{ role: 'user', content: 'oi' }] };

/** fetch falso: registra as chamadas e devolve o que o handler mandar. */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const call = { url, init, body: JSON.parse(init.body) };
    calls.push(call);
    return handler(call);
  };
  fn.calls = calls;
  return fn;
}

/** Resposta SSE completa, em pedaços pequenos para exercitar o leitor. */
function sseResponse(text, status = 200) {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += 37) c.enqueue(bytes.slice(i, i + 37));
      c.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

/** Resposta que manda `first` e fica aberta; o abort do pedido derruba o corpo. */
function hangingResponse(init, first = '') {
  const stream = new ReadableStream({
    start(c) {
      if (first) c.enqueue(new TextEncoder().encode(first));
      init.signal?.addEventListener('abort', () => c.error(init.signal.reason ?? new Error('abort')), { once: true });
    },
  });
  return new Response(stream, { status: 200 });
}

async function collect(run) {
  const events = [];
  for await (const ev of run) events.push(ev);
  return events;
}

async function failure(run) {
  const events = [];
  try {
    for await (const ev of run) events.push(ev);
  } catch (err) {
    return { err, events };
  }
  assert.fail('esperava erro');
}

test('texto simples: url, headers, corpo e eventos', async () => {
  const f = fakeFetch(() => sseResponse(fixture('text.sse')));
  const client = createClient({ account, model: baseModel, fetch: f });
  const run = client.chat({ system: 'Seja breve.', ...userHi });
  const events = await collect(run);

  assert.deepEqual(events.slice(0, 2), [{ type: 'text', text: 'Olá' }, { type: 'text', text: ', mundo!' }]);
  const end = events[2];
  assert.equal(end.type, 'end');
  assert.equal(end.finishReason, 'stop');
  assert.equal(end.usage.input, 25);
  assert.equal(end.usage.output, 12);
  assert.equal(end.cost.source, 'none');
  assert.deepEqual(await run.result, { finishReason: 'stop', usage: end.usage, cost: end.cost });

  const [call] = f.calls;
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.init.headers['x-api-key'], 'sk-teste');
  assert.equal(call.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(call.init.headers['content-type'], 'application/json');
  assert.equal(call.init.headers.accept, 'text/event-stream');
  assert.equal(call.body.stream, true);
  assert.equal(call.body.max_tokens, 1024);
  assert.deepEqual(call.body.system, [{ type: 'text', text: 'Seja breve.' }]);
  assert.deepEqual(call.body.messages, [{ role: 'user', content: [{ type: 'text', text: 'oi' }] }]);
});

test('tool call fragmentada: arguments completos, vazio vira {}', async () => {
  const f = fakeFetch(() => sseResponse(fixture('tool-call.sse')));
  const client = createClient({ account, model: baseModel, fetch: f });
  const events = await collect(client.chat({
    ...userHi,
    tools: [{ name: 'get_weather', description: 'Clima', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
  }));
  const calls = events.filter((e) => e.type === 'tool_call');
  assert.deepEqual(calls, [
    { type: 'tool_call', id: 'toolu_01A', name: 'get_weather', arguments: '{"city": "Campo Grande"}' },
    { type: 'tool_call', id: 'toolu_02B', name: 'ping_server', arguments: '{}' },
  ]);
  assert.deepEqual(JSON.parse(calls[0].arguments), { city: 'Campo Grande' });
  assert.equal(events.at(-1).finishReason, 'tool_calls');
  assert.deepEqual(f.calls[0].body.tools, [
    { name: 'get_weather', description: 'Clima', input_schema: { type: 'object', properties: { city: { type: 'string' } } } },
  ]);
});

test('cache em toolCalls vira cache_control no tool_use', async () => {
  const f = fakeFetch(() => sseResponse(fixture('text.sse')));
  const client = createClient({ account, model: baseModel, fetch: f });
  await collect(client.chat({ messages: [
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: '', toolCalls: [
      { id: 't1', name: 'a', arguments: '{}' },
      { id: 't2', name: 'b', arguments: '{}', cache: { ttl: '1h' } },
    ] },
  ] }));
  const blocks = f.calls[0].body.messages[1].content;
  assert.equal(blocks[0].cache_control, undefined);
  assert.deepEqual(blocks[1].cache_control, { type: 'ephemeral', ttl: '1h' });
});

test('raciocínio: thinking_delta vira reasoning e o corpo liga o thinking adaptativo', async () => {
  const f = fakeFetch(() => sseResponse(fixture('thinking.sse')));
  const model = { ...baseModel, id: 'claude-sonnet-5', reasoning: true, compat: { thinkingByDefault: true } };
  const events = await collect(createClient({ account, model, fetch: f }).chat({ ...userHi, effort: 'high' }));
  assert.deepEqual(events.filter((e) => e.type !== 'end'), [
    { type: 'reasoning', text: 'Preciso somar ' },
    { type: 'reasoning', text: '2 + 2.' },
    { type: 'reasoning', text: '', signature: 'EqQBCgIYAhIM' }, // signature_delta do fixture: agora é evento (Task 4.2)
    { type: 'text', text: '4' },
  ]);
  assert.deepEqual(f.calls[0].body.thinking, { type: 'adaptive' });
  assert.deepEqual(f.calls[0].body.output_config, { effort: 'high' });
  assert.equal(f.calls[0].body.max_tokens, 16000);
});

test('saída estruturada: schema vai em output_config.format', async () => {
  const f = fakeFetch(() => sseResponse(fixture('structured.sse')));
  const schema = { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] };
  const events = await collect(createClient({ account, model: baseModel, fetch: f }).chat({ ...userHi, responseSchema: { schema } }));
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), '{"nome":"Ana","idade":30}');
  assert.deepEqual(f.calls[0].body.output_config, { format: { type: 'json_schema', schema } });
});

test('imagem em data-url e em url viram source base64 e url', async () => {
  const f = fakeFetch(() => sseResponse(fixture('text.sse')));
  const client = createClient({ account, model: baseModel, fetch: f });
  await collect(client.chat({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'o que é isto?' },
        { type: 'image', data: 'iVBORw0KGgo=', mime: 'image/png' },
        { type: 'image', data: 'data:image/jpeg;base64,/9j/4AAQ' },
        { type: 'image', url: 'https://exemplo.com/a.webp', mime: 'image/webp' },
      ],
    }],
  }));
  assert.deepEqual(f.calls[0].body.messages[0].content, [
    { type: 'text', text: 'o que é isto?' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } },
    { type: 'image', source: { type: 'url', url: 'https://exemplo.com/a.webp' } },
  ]);
});

test('mídia não suportada: unsupported antes do fetch (áudio, vídeo, imagem sem input, url sem transporte)', async () => {
  const cases = [
    ['áudio', baseModel, { type: 'audio', data: 'AAAA', format: 'wav' }, /áudio/],
    ['vídeo', baseModel, { type: 'video', url: 'https://x/v.mp4', mime: 'video/mp4' }, /vídeo/],
    ['imagem sem input', { ...baseModel, input: ['text'] }, { type: 'image', url: 'https://x/a.png' }, /imagem/],
    ['url só data-url', { ...baseModel, transport: { image: ['data-url'] } }, { type: 'image', url: 'https://x/a.png' }, /data-url/],
    ['data-url sem transporte', { ...baseModel, transport: { image: ['url'] } }, { type: 'image', data: 'AAAA', mime: 'image/png' }, /data-url/],
  ];
  for (const [nome, model, part, re] of cases) {
    const f = fakeFetch(() => sseResponse(fixture('text.sse')));
    const run = createClient({ account, model, fetch: f }).chat({ messages: [{ role: 'user', content: [part] }] });
    const { err, events } = await failure(run);
    assert.equal(err.type, 'unsupported', nome);
    assert.equal(err.retryOther, true, nome);
    assert.equal(err.emitted, false, nome);
    assert.match(err.message, re, nome);
    assert.equal(events.length, 0);
    assert.equal(f.calls.length, 0, `${nome}: fetch não pode ser chamado`);
    await assert.rejects(run.result, (e) => e.type === 'unsupported');
  }
});

for (const [status, type, retryOther] of [[401, 'auth', true], [429, 'rate_limit', true], [500, 'upstream', true]]) {
  test(`HTTP ${status} vira ${type}`, async () => {
    const body = JSON.stringify({ type: 'error', error: { type: 'x_error', message: 'falhou por teste' } });
    const f = fakeFetch(() => new Response(body, { status }));
    const run = createClient({ account, model: baseModel, fetch: f }).chat(userHi);
    const { err } = await failure(run);
    assert.equal(err.type, type);
    assert.equal(err.status, status);
    assert.equal(err.retryOther, retryOther);
    assert.equal(err.emitted, false);
    assert.equal(err.provider, 'anthropic');
    assert.match(err.message, /falhou por teste/);
    await assert.rejects(run.result);
  });
}

test('erro no meio do stream: overloaded vira upstream 529 com emitted true', async () => {
  const f = fakeFetch(() => sseResponse(fixture('error-mid-stream.sse')));
  const run = createClient({ account, model: baseModel, fetch: f }).chat(userHi);
  const { err, events } = await failure(run);
  assert.deepEqual(events, [{ type: 'text', text: 'Resposta parcial' }]);
  assert.equal(err.type, 'upstream');
  assert.equal(err.status, 529);
  assert.equal(err.emitted, true);
  assert.match(err.message, /Overloaded/);
  await assert.rejects(run.result, (e) => e === err);
});

test('erros do stream: mapa do tipo para o status', async () => {
  for (const [errType, status, type] of [
    ['rate_limit_error', 429, 'rate_limit'],
    ['invalid_request_error', 400, 'invalid_request'],
    ['authentication_error', 401, 'auth'],
    ['api_error', 500, 'upstream'],
  ]) {
    const sse = `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: errType, message: 'm' } })}\n\n`;
    const f = fakeFetch(() => sseResponse(sse));
    const { err } = await failure(createClient({ account, model: baseModel, fetch: f }).chat(userHi));
    assert.equal(err.status, status, errType);
    assert.equal(err.type, type, errType);
    assert.equal(err.emitted, false);
  }
});

test('stream cortado sem message_stop é erro, não fim silencioso', async () => {
  const sse = fixture('text.sse').split('event: message_stop')[0];
  const f = fakeFetch(() => sseResponse(sse));
  const { err, events } = await failure(createClient({ account, model: baseModel, fetch: f }).chat(userHi));
  assert.equal(err.type, 'upstream');
  assert.match(err.message, /message_stop/);
  assert.equal(err.emitted, true);
  assert.equal(events.length, 2);
});

test('timeout de primeiro byte', async () => {
  const f = fakeFetch((c) => hangingResponse(c.init));
  const client = createClient({ account: { ...account, timeouts: { firstByteMs: 30, idleMs: 5000 } }, model: baseModel, fetch: f });
  const { err } = await failure(client.chat(userHi));
  assert.equal(err.type, 'timeout');
  assert.equal(err.emitted, false);
  assert.match(err.message, /primeiro byte/);
});

test('timeout de inatividade depois do primeiro evento', async () => {
  const first = fixture('text.sse').split('event: content_block_stop')[0];
  const f = fakeFetch((c) => hangingResponse(c.init, first));
  const client = createClient({ account: { ...account, timeouts: { firstByteMs: 5000, idleMs: 30 } }, model: baseModel, fetch: f });
  const { err, events } = await failure(client.chat(userHi));
  assert.equal(err.type, 'timeout');
  assert.equal(err.emitted, true);
  assert.match(err.message, /inatividade/);
  assert.equal(events.map((e) => e.text).join(''), 'Olá, mundo!');
});

test('abort do chamador: aborted, retryOther false', async () => {
  const first = fixture('text.sse').split('event: content_block_stop')[0];
  const f = fakeFetch((c) => hangingResponse(c.init, first));
  const ac = new AbortController();
  const run = createClient({ account, model: baseModel, fetch: f }).chat({ ...userHi, signal: ac.signal });
  const seen = [];
  let caught;
  try {
    for await (const ev of run) {
      seen.push(ev);
      if (seen.length === 1) ac.abort();
    }
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'esperava erro');
  assert.equal(caught.type, 'aborted');
  assert.equal(caught.retryOther, false);
  assert.equal(caught.emitted, true);
  await assert.rejects(run.result, (e) => e.type === 'aborted');
});

const priced = {
  ...baseModel,
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, cacheWrite1h: 6 },
};

test('custo pela tabela com cache de 5 min e de 1 h, disjuntos', async () => {
  const f = fakeFetch(() => sseResponse(fixture('cache.sse')));
  const { usage, cost } = await createClient({ account, model: priced, fetch: f }).chat(userHi).result;
  assert.equal(usage.input, 1000);
  assert.equal(usage.output, 200);
  assert.equal(usage.cacheRead, 2000);
  assert.equal(usage.cacheWrite, 500);
  assert.equal(usage.cacheWrite1h, 1000);
  assert.equal(usage.raw.cache_creation_input_tokens, 1500);
  assert.equal(cost.source, 'table');
  // (1000*3 + 200*15 + 2000*0.3 + 500*3.75 + 1000*6) / 1e6
  assert.ok(Math.abs(cost.usd - 0.014475) < 1e-12, String(cost.usd));
});

test('cache_creation_input_tokens sem detalhe conta como 5 min; max_tokens vira length', async () => {
  const f = fakeFetch(() => sseResponse(fixture('legacy-cache-length.sse')));
  const { usage, finishReason } = await createClient({ account, model: priced, fetch: f }).chat(userHi).result;
  assert.equal(finishReason, 'length');
  assert.equal(usage.cacheWrite, 700);
  assert.equal(usage.cacheWrite1h, 0);
  assert.equal(usage.output, 5);
});

test('tool_result agrupado e histórico com tool_use chegam ao fio', async () => {
  const f = fakeFetch(() => sseResponse(fixture('text.sse')));
  await collect(createClient({ account, model: baseModel, fetch: f }).chat({
    messages: [
      { role: 'user', content: 'clima?' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_1', name: 'get_weather', arguments: '{"city":"X"}' }] },
      { role: 'tool', toolCallId: 'toolu_1', content: '30C' },
      { role: 'user', content: 'e agora?' },
    ],
  }));
  const msgs = f.calls[0].body.messages;
  assert.equal(msgs.length, 3);
  assert.deepEqual(msgs[1].content, [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'X' } }]);
  assert.deepEqual(msgs[2], {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '30C' }, { type: 'text', text: 'e agora?' }],
  });
});

test('stream sem uso nenhum: usage zerado com missing e custo none, nunca zero silencioso', async () => {
  const sse = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"m","role":"assistant","content":[]}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"oi"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ].join('');
  const priced = { ...baseModel, cost: { input: 1, output: 5 } };
  const f = fakeFetch(() => sseResponse(sse));
  const { usage, cost } = await createClient({ account, model: priced, fetch: f }).chat(userHi).result;
  assert.deepEqual({ ...usage }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, missing: true });
  assert.deepEqual({ ...cost }, { usd: null, source: 'none' });
});

// ---------------------------------------------------------------------------------------
// T1.2 · Fase 4 · Task 4.2 — raciocínio assinado: leitura

/** SSE da Messages API a partir de uma lista de eventos já em objeto. */
const sseOf = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const msgStart = { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } };
const msgEnd = (reason = 'end_turn') => [{ type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 3 } }, { type: 'message_stop' }];

test('signature_delta vira evento reasoning com text vazio e a assinatura', async () => {
  const f = fakeFetch(() => sseResponse(sseOf([
    msgStart,
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'somando' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG-A' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '4' } },
    { type: 'content_block_stop', index: 1 },
    ...msgEnd(),
  ])));
  const events = await collect(createClient({ account, model: baseModel, fetch: f }).chat(userHi));
  assert.deepEqual(events.filter((e) => e.type !== 'end'), [
    { type: 'reasoning', text: 'somando' },
    { type: 'reasoning', text: '', signature: 'SIG-A' },
    { type: 'text', text: '4' },
  ]);
});

test('signature_delta vazio não vira evento', async () => {
  const f = fakeFetch(() => sseResponse(sseOf([
    msgStart,
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: '' } },
    { type: 'content_block_stop', index: 0 },
    ...msgEnd(),
  ])));
  const events = await collect(createClient({ account, model: baseModel, fetch: f }).chat(userHi));
  assert.deepEqual(events.map((e) => e.type), ['end']);
});

test('bloco redacted_thinking vira evento reasoning com redacted e text vazio', async () => {
  const f = fakeFetch(() => sseResponse(sseOf([
    msgStart,
    { type: 'content_block_start', index: 0, content_block: { type: 'redacted_thinking', data: 'EmwKAhgB-RED' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'oi' } },
    { type: 'content_block_stop', index: 1 },
    ...msgEnd(),
  ])));
  const events = await collect(createClient({ account, model: baseModel, fetch: f }).chat(userHi));
  assert.deepEqual(events.filter((e) => e.type !== 'end'), [
    { type: 'reasoning', text: '', redacted: 'EmwKAhgB-RED' },
    { type: 'text', text: 'oi' },
  ]);
});

test('ciclo completo: o raciocínio assinado lido volta no pedido seguinte, antes da tool call', async () => {
  const f = fakeFetch(() => sseResponse(sseOf([
    msgStart,
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'vou ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'consultar' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG-B' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'soma', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":1}' } },
    { type: 'content_block_stop', index: 1 },
    ...msgEnd('tool_use'),
  ])));
  const client = createClient({ account, model: baseModel, fetch: f });
  const events = await collect(client.chat({ ...userHi, tools: [{ name: 'soma', parameters: { type: 'object' } }] }));
  // o chamador junta os eventos em partes, como o Gateway faz
  const reasoning = events.filter((e) => e.type === 'reasoning');
  const part = { type: 'reasoning', text: reasoning.map((e) => e.text).join(''), signature: reasoning.find((e) => e.signature)?.signature };
  const call = events.find((e) => e.type === 'tool_call');
  assert.equal('providerData' in call, false); // a Anthropic não tem dado opaco na tool call
  await collect(client.chat({
    ...userHi,
    tools: [{ name: 'soma', parameters: { type: 'object' } }],
    messages: [
      userHi.messages[0],
      { role: 'assistant', content: [part], toolCalls: [{ id: call.id, name: call.name, arguments: call.arguments }] },
      { role: 'tool', toolCallId: call.id, content: '1' },
    ],
  }));
  assert.deepEqual(f.calls[1].body.messages[1].content, [
    { type: 'thinking', thinking: 'vou consultar', signature: 'SIG-B' },
    { type: 'tool_use', id: 'toolu_1', name: 'soma', input: { a: 1 } },
  ]);
});
