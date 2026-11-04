// Fio openai-responses: pedido (buildRequest) e stream (parseStream), pelas tabelas da Task 5.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '../src/client.js';
import { resolveCompat } from '../src/compat.js';
import * as lib from '../src/index.js';
import { buildRequest } from '../src/apis/openai-responses.js';

const account = { id: 'oa', provider: 'openai', api: 'openai-responses', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' };
const model = { id: 'gpt-5.4-nano', operations: ['chat'], input: ['text', 'image', 'file'], output: ['text'] };
const hi = [{ role: 'user', content: 'oi' }];

/** Monta com o compat resolvido, como o cliente faz. `compat` entra na conta. */
function build(request, { acc = account, mdl = model, compat } = {}) {
  const a = compat ? { ...acc, compat } : acc;
  return buildRequest({ account: a, model: mdl, compat: resolveCompat(a, mdl), request, apiKey: 'sk-test' });
}

/** @param {() => unknown} fn @param {string} type @param {boolean} retryOther */
function throwsType(fn, type, retryOther) {
  assert.throws(fn, (e) => e.name === 'ProviderError' && e.type === type && e.retryOther === retryOther, `esperava ${type}`);
}

// ---------------------------------------------------------------------------------------
// registro e compat

test('o fio está registrado e o compat padrão manda max_output_tokens, conservador no resto', () => {
  assert.ok(lib.listApis().includes('openai-responses'));
  const c = resolveCompat(account);
  assert.equal(c.maxTokensField, 'max_output_tokens');
  assert.equal(c.structuredOutput, 'none');
  assert.equal(c.reasoningFormat, 'none');
  assert.equal(c.supportsStore, false);
  assert.equal(c.cacheMarker, 'none');
});

// ---------------------------------------------------------------------------------------
// buildRequest — campos básicos

test('URL, Bearer e corpo mínimo: model, input com type explícito e stream', () => {
  const r = build({ messages: hi });
  assert.equal(r.url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(r.headers, { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: 'Bearer sk-test' });
  assert.deepEqual(r.body, { model: 'gpt-5.4-nano', input: [{ type: 'message', role: 'user', content: 'oi' }], stream: true });
  assert.equal(build({ messages: hi }, { acc: { ...account, baseUrl: 'http://127.0.0.1:8080/v1//' } }).url, 'http://127.0.0.1:8080/v1/responses');
  // sem chave (servidor local): sem Authorization
  assert.equal('Authorization' in buildRequest({ account, model, compat: resolveCompat(account), request: { messages: hi }, apiKey: '' }).headers, false);
});

test('messages precisa ser uma lista e papel desconhecido é invalid_request', () => {
  throwsType(() => build({ messages: 'oi' }), 'invalid_request', false);
  throwsType(() => build({ messages: [{ role: 'system', content: 'x' }] }), 'invalid_request', false);
  throwsType(() => build({ messages: [null] }), 'invalid_request', false);
});

test('system: item message de papel system; blocos se juntam sem separador; vazio some; marca de cache não vai', () => {
  assert.deepEqual(build({ system: 'regras', messages: hi }).body.input[0], { type: 'message', role: 'system', content: 'regras' });
  const blocks = build({ system: [{ text: 'a', cache: { ttl: '5m' } }, { text: 'b' }], messages: hi }, { compat: { cacheMarker: 'cache_control' } });
  assert.deepEqual(blocks.body.input[0], { type: 'message', role: 'system', content: 'ab' });
  assert.equal(build({ system: '', messages: hi }).body.input.length, 1);
  assert.equal(build({ system: [], messages: hi }).body.input.length, 1);
  // supportsDeveloperRole não muda o papel: o llama.cpp e o fio testado no Igris usam system
  assert.equal(build({ system: 'x', messages: hi }, { compat: { supportsDeveloperRole: true } }).body.input[0].role, 'system');
});

test('user com partes: input_text, input_image (data-url e URL) e input_file', () => {
  const r = build({ messages: [{ role: 'user', content: [
    { type: 'text', text: 'olha', cache: { ttl: '5m' } },
    { type: 'image', data: 'QUJD', mime: 'image/png' },
    { type: 'image', data: 'data:image/jpeg;base64,REVG' },
    { type: 'image', url: 'https://x.test/a.png' },
    { type: 'file', data: 'JVBERg==', mime: 'application/pdf', name: 'doc.pdf' },
    { type: 'file', data: 'data:text/plain;base64,aGk=' },
  ] }] });
  assert.deepEqual(r.body.input, [{ type: 'message', role: 'user', content: [
    { type: 'input_text', text: 'olha' },
    { type: 'input_image', image_url: 'data:image/png;base64,QUJD' },
    { type: 'input_image', image_url: 'data:image/jpeg;base64,REVG' },
    { type: 'input_image', image_url: 'https://x.test/a.png' },
    { type: 'input_file', filename: 'doc.pdf', file_data: 'data:application/pdf;base64,JVBERg==' },
    { type: 'input_file', filename: 'arquivo.txt', file_data: 'data:text/plain;base64,aGk=' },
  ] }]);
});

test('user: arquivo por URL só com transport.file declarado, e vai como file_url', () => {
  const part = { type: 'file', url: 'https://x.test/a.pdf', name: 'a.pdf' };
  throwsType(() => build({ messages: [{ role: 'user', content: [part] }] }), 'unsupported', true);
  const mdl = { ...model, transport: { file: ['url'] } };
  assert.deepEqual(build({ messages: [{ role: 'user', content: [part] }] }, { mdl }).body.input[0].content, [{ type: 'input_file', filename: 'a.pdf', file_url: 'https://x.test/a.pdf' }]);
});

test('user: áudio e vídeo dão unsupported, mesmo com o modelo declarando a entrada; imagem sem declaração também', () => {
  const rich = { ...model, input: ['text', 'image', 'audio', 'video', 'file'], transport: { audio: 'input_audio', video: 'video_url' } };
  throwsType(() => build({ messages: [{ role: 'user', content: [{ type: 'audio', data: 'QQ==', format: 'mp3' }] }] }, { mdl: rich }), 'unsupported', true);
  throwsType(() => build({ messages: [{ role: 'user', content: [{ type: 'video', url: 'https://x.test/v.mp4' }] }] }, { mdl: rich }), 'unsupported', true);
  throwsType(() => build({ messages: [{ role: 'user', content: [{ type: 'image', data: 'QQ==', mime: 'image/png' }] }] }, { mdl: { ...model, input: ['text'] } }), 'unsupported', true);
  // parte malformada e parte reasoning na entrada são invalid_request
  throwsType(() => build({ messages: [{ role: 'user', content: [{ type: 'image' }] }] }), 'invalid_request', false);
  throwsType(() => build({ messages: [{ role: 'user', content: [{ type: 'reasoning', text: 'x' }] }] }), 'invalid_request', false);
  throwsType(() => build({ messages: [{ role: 'user', content: [{ type: 'xyz' }] }] }), 'invalid_request', false);
});

test('assistant: message com o texto, seguido de um function_call por tool call', () => {
  const r = build({ messages: [
    { role: 'user', content: 'clima?' },
    { role: 'assistant', content: 'Vou ver.', toolCalls: [
      { id: 'call_1', name: 'clima', arguments: '{"cidade":"CG"}' },
      { id: 'call_2', name: 'hora', arguments: '' },
    ] },
  ] });
  assert.deepEqual(r.body.input.slice(1), [
    { type: 'message', role: 'assistant', content: 'Vou ver.' },
    { type: 'function_call', call_id: 'call_1', name: 'clima', arguments: '{"cidade":"CG"}' },
    { type: 'function_call', call_id: 'call_2', name: 'hora', arguments: '{}' },
  ]);
});

test('assistant: sem texto e com tool call não gera message; sem texto nem tool call some; partes de texto se juntam', () => {
  const r = build({ messages: [
    { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'f', arguments: '{}' }] },
    { role: 'assistant', content: '' },
    { role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
  ] });
  assert.deepEqual(r.body.input, [
    { type: 'function_call', call_id: 'c', name: 'f', arguments: '{}' },
    { type: 'message', role: 'assistant', content: 'ab' },
  ]);
  // mídia no papel assistant não tem formato aqui
  throwsType(() => build({ messages: [{ role: 'assistant', content: [{ type: 'image', url: 'https://x.test/a.png' }] }] }), 'unsupported', true);
});

test('assistant: a parte reasoning é ignorada de propósito, de qualquer provedor', () => {
  const r = build({ messages: [{ role: 'assistant', content: [
    { type: 'reasoning', text: 'pensei', signature: 'sig' },
    { type: 'reasoning', text: '', redacted: 'AAAA' },
    { type: 'text', text: 'resposta' },
  ], toolCalls: [{ id: 'c', name: 'f', arguments: '{}', providerData: { thoughtSignature: 'x' } }] }] });
  assert.deepEqual(r.body.input, [
    { type: 'message', role: 'assistant', content: 'resposta' },
    { type: 'function_call', call_id: 'c', name: 'f', arguments: '{}' },
  ]);
  assert.equal(JSON.stringify(r.body).includes('sig'), false);
});

test('tool: function_call_output; isError prefixa o texto; toolName é ignorado', () => {
  const r = build({ messages: [
    { role: 'tool', toolCallId: 'call_1', content: '31 graus', toolName: 'clima' },
    { role: 'tool', toolCallId: 'call_2', content: [{ type: 'text', text: 'falhou' }], isError: true },
    { role: 'tool', toolCallId: 'call_3', content: 'ok', isError: false },
  ] });
  assert.deepEqual(r.body.input, [
    { type: 'function_call_output', call_id: 'call_1', output: '31 graus' },
    { type: 'function_call_output', call_id: 'call_2', output: 'Tool error: falhou' },
    { type: 'function_call_output', call_id: 'call_3', output: 'ok' },
  ]);
  throwsType(() => build({ messages: [{ role: 'tool', content: 'x' }] }), 'invalid_request', false);
  throwsType(() => build({ messages: [{ role: 'tool', toolCallId: 'c', content: [{ type: 'image', url: 'https://x.test/a.png' }] }] }), 'unsupported', true);
});

// ---------------------------------------------------------------------------------------
// buildRequest — tools, tool_choice, saída estruturada

const tools = [
  { name: 'clima', description: 'Clima de uma cidade', parameters: { type: 'object', properties: { cidade: { type: 'string' } } } },
  { name: 'hora', parameters: { type: 'object', properties: {} } },
];

test('tools no formato plano, sem o envelope function', () => {
  assert.deepEqual(build({ messages: hi, tools }).body.tools, [
    { type: 'function', name: 'clima', description: 'Clima de uma cidade', parameters: { type: 'object', properties: { cidade: { type: 'string' } } } },
    { type: 'function', name: 'hora', parameters: { type: 'object', properties: {} } },
  ]);
  assert.equal('tools' in build({ messages: hi, tools: [] }).body, false);
});

test('tool_choice: auto, none, required e a tool nomeada', () => {
  const choice = (toolChoice) => build({ messages: hi, tools, toolChoice }).body.tool_choice;
  assert.equal(choice('auto'), 'auto');
  assert.equal(choice('none'), 'none');
  assert.equal(choice('required'), 'required');
  assert.deepEqual(choice({ name: 'clima' }), { type: 'function', name: 'clima' });
  assert.equal('tool_choice' in build({ messages: hi, tools }).body, false);
});

test('toolChoice explícito vence params.tool_choice', () => {
  assert.equal(build({ messages: hi, tools, toolChoice: 'none', params: { tool_choice: 'auto' } }).body.tool_choice, 'none');
  assert.equal(build({ messages: hi, tools, params: { tool_choice: 'required' } }).body.tool_choice, 'required');
});

test('toolChoice sem tools ou malformado é invalid_request, sem outro alvo', () => {
  throwsType(() => build({ messages: hi, toolChoice: 'auto' }), 'invalid_request', false);
  throwsType(() => build({ messages: hi, tools: [], toolChoice: 'required' }), 'invalid_request', false);
  throwsType(() => build({ messages: hi, tools, toolChoice: 'sempre' }), 'invalid_request', false);
  throwsType(() => build({ messages: hi, tools, toolChoice: { name: '' } }), 'invalid_request', false);
});

test('responseSchema: text.format com structuredOutput text_format; nome e strict têm padrão', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
  const compat = { structuredOutput: 'text_format' };
  assert.deepEqual(build({ messages: hi, responseSchema: { schema } }, { compat }).body.text, { format: { type: 'json_schema', name: 'response', strict: true, schema } });
  assert.deepEqual(
    build({ messages: hi, responseSchema: { name: 'envelope', strict: false, schema } }, { compat }).body.text,
    { format: { type: 'json_schema', name: 'envelope', strict: false, schema } },
  );
});

test('responseSchema com outro structuredOutput dá unsupported (a conta genérica é conservadora)', () => {
  const req = { messages: hi, responseSchema: { schema: { type: 'object' } } };
  throwsType(() => build(req), 'unsupported', true);
  for (const structuredOutput of ['response_format', 'output_config', 'response_json_schema']) {
    throwsType(() => build(req, { compat: { structuredOutput } }), 'unsupported', true);
  }
});

// ---------------------------------------------------------------------------------------
// buildRequest — reasoning, limites, store, stop, cachedContent

test('effort vira reasoning.effort só com reasoningFormat reasoning_object; com none é ignorado sem erro', () => {
  assert.deepEqual(build({ messages: hi, effort: 'low' }, { compat: { reasoningFormat: 'reasoning_object' } }).body.reasoning, { effort: 'low' });
  assert.equal('reasoning' in build({ messages: hi, effort: 'high' }).body, false);
  throwsType(() => build({ messages: hi, effort: 'low' }, { compat: { reasoningFormat: 'anthropic_thinking' } }), 'unsupported', true);
  throwsType(() => build({ messages: hi, effort: 'low' }, { compat: { reasoningFormat: 'reasoning_effort' } }), 'unsupported', true);
});

test('reasoning.maxTokens e exclude dão unsupported, com ou sem effort e em qualquer formato', () => {
  for (const reasoningFormat of ['reasoning_object', 'none', 'reasoning_effort']) {
    const compat = { reasoningFormat };
    throwsType(() => build({ messages: hi, reasoning: { maxTokens: 1000 } }, { compat }), 'unsupported', true);
    throwsType(() => build({ messages: hi, reasoning: { exclude: true } }, { compat }), 'unsupported', true);
    throwsType(() => build({ messages: hi, effort: 'low', reasoning: { maxTokens: 1000 } }, { compat }), 'unsupported', true);
  }
  // objeto vazio não pede nada
  assert.equal('reasoning' in build({ messages: hi, reasoning: {} }, { compat: { reasoningFormat: 'reasoning_object' } }).body, false);
});

test('maxTokens vai em max_output_tokens (campo do compat); o teto do modelo não é enviado', () => {
  assert.equal(build({ messages: hi, maxTokens: 99 }).body.max_output_tokens, 99);
  const mdl = { ...model, maxTokens: 128000 };
  assert.equal('max_output_tokens' in build({ messages: hi }, { mdl }).body, false);
  const other = build({ messages: hi, maxTokens: 7 }, { compat: { maxTokensField: 'max_tokens' } }).body;
  assert.equal(other.max_tokens, 7);
  assert.equal('max_output_tokens' in other, false);
});

test('temperature segue supportsTemperature; store:false só com supportsStore', () => {
  assert.equal(build({ messages: hi, temperature: 0.2 }, { compat: { supportsTemperature: true } }).body.temperature, 0.2);
  assert.equal('temperature' in build({ messages: hi, temperature: 0.2 }).body, false);
  assert.equal('store' in build({ messages: hi }).body, false);
  assert.equal(build({ messages: hi }, { compat: { supportsStore: true } }).body.store, false);
});

test('stop e cachedContent dão unsupported: a Responses API não tem esses campos', () => {
  throwsType(() => build({ messages: hi, stop: ['FIM'] }), 'unsupported', true);
  throwsType(() => build({ messages: hi, cachedContent: 'cachedContents/abc' }), 'unsupported', true);
  // lista vazia é o mesmo que não pedir; lista malformada é pedido errado
  assert.equal('stop' in build({ messages: hi, stop: [] }).body, false);
  throwsType(() => build({ messages: hi, stop: 'FIM' }), 'invalid_request', false);
});

test('params: do modelo e depois da chamada; o que é do fio não é sobrescrito; text e reasoning se fundem', () => {
  const mdl = { ...model, params: { top_p: 0.5, metadata: { a: 1 }, text: { verbosity: 'low' } } };
  const b = build({ messages: hi, params: { top_p: 0.9, model: 'outro', stream: false, input: [], tools: [1], provider: { order: ['x'] } } }, { mdl }).body;
  assert.equal(b.top_p, 0.9);
  assert.deepEqual(b.metadata, { a: 1 });
  assert.equal(b.model, 'gpt-5.4-nano');
  assert.equal(b.stream, true);
  assert.equal(b.input.length, 1);
  assert.equal('tools' in b, false);
  assert.equal('provider' in b, false); // roteamento só com compat.providerRouting
  assert.deepEqual(b.text, { verbosity: 'low' });
  assert.deepEqual(build({ messages: hi, params: { provider: { order: ['x'] } } }, { compat: { providerRouting: true } }).body.provider, { order: ['x'] });

  const schema = { type: 'object' };
  const merged = build(
    { messages: hi, effort: 'low', responseSchema: { schema }, params: { text: { verbosity: 'high', format: { type: 'text' } }, reasoning: { summary: 'auto', effort: 'high' } } },
    { mdl, compat: { structuredOutput: 'text_format', reasoningFormat: 'reasoning_object' } },
  ).body;
  assert.deepEqual(merged.text, { verbosity: 'high', format: { type: 'json_schema', name: 'response', strict: true, schema } });
  assert.deepEqual(merged.reasoning, { summary: 'auto', effort: 'low' });
});

// ---------------------------------------------------------------------------------------
// stream

const fixture = (/** @type {string} */ name) => readFileSync(new URL(`./fixtures/openai-responses/${name}`, import.meta.url), 'utf8');

/** fetch falso: devolve o texto SSE de uma vez e guarda o último pedido. */
function fakeFetch(/** @type {string} */ sse) {
  const fn = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    fn.last = { url, init, body: JSON.parse(init.body) };
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  return fn;
}

/** Roda o chat inteiro e devolve eventos + resultado. */
async function chat(/** @type {string} */ sse, { mdl = model, request = { messages: hi } } = {}) {
  const run = createClient({ account, model: mdl, fetch: fakeFetch(sse) }).chat(request);
  /** @type {any[]} */ const events = [];
  for await (const ev of run) events.push(ev);
  return { events, result: await run.result };
}
async function chatError(/** @type {string} */ sse) {
  try { await chat(sse); } catch (e) { return /** @type {any} */ (e); }
  return assert.fail('esperava erro');
}

test('response.output_text.delta vira text; response.completed fecha com stop e uso', async () => {
  const { events, result } = await chat(fixture('text.sse'), { mdl: { ...model, cost: { input: 1, output: 2 } } });
  assert.deepEqual(events[0], { type: 'text', text: 'pong' });
  assert.equal(events.length, 2);
  assert.equal(events[1].type, 'end');
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual({ ...result.usage, raw: undefined }, { input: 12, output: 5, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, raw: undefined });
  assert.equal(/** @type {any} */ (result.usage.raw).total_tokens, 17);
  assert.deepEqual(result.cost, { usd: 0.000022, source: 'table' });
});

test('uso: input sem o cache lido, reasoning de output_tokens_details e raw', async () => {
  const { events, result } = await chat(fixture('reasoning.sse'));
  assert.equal(result.usage.input, 20); // 30 - 10 em cache
  assert.equal(result.usage.cacheRead, 10);
  assert.equal(result.usage.cacheWrite, 0);
  assert.equal(result.usage.output, 70);
  assert.equal(result.usage.reasoning, 64);
  assert.equal(/** @type {any} */ (result.usage.raw).input_tokens, 30);
  assert.equal(events.at(-1).usage, result.usage);
});

test('response.reasoning_summary_text.delta vira reasoning', async () => {
  const { events } = await chat(fixture('reasoning.sse'));
  assert.deepEqual(events.slice(0, 3), [
    { type: 'reasoning', text: '**Somando**\n\nPreciso ' },
    { type: 'reasoning', text: 'somar 2 e 2.' },
    { type: 'text', text: '4' },
  ]);
});

test('function_call: guarda call_id e name pelo item.id, acumula os argumentos e emite no output_item.done', async () => {
  const { events, result } = await chat(fixture('tool-call-two.sse'), { request: { messages: hi, tools } });
  assert.deepEqual(events.slice(0, 2), [
    { type: 'tool_call', id: 'call_clima1', name: 'clima', arguments: '{"cidade":"Campo Grande"}' },
    { type: 'tool_call', id: 'call_hora2', name: 'hora', arguments: '{}' },
  ]);
  assert.equal(events.length, 3);
  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.usage.input, 62);
});

test('função com argumentos só nos deltas (sem arguments no item.done) usa o acumulado', async () => {
  const sse = [
    'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","arguments":"","call_id":"call_x","name":"clima"}}\n\n',
    'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"{\\"a\\":"}\n\n',
    'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"1}"}\n\n',
    'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_x","name":"clima"}}\n\n',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2}}}\n\n',
  ].join('');
  const { events } = await chat(sse);
  assert.deepEqual(events[0], { type: 'tool_call', id: 'call_x', name: 'clima', arguments: '{"a":1}' });
});

test('função sem argumentos vira {}; argumentos que não são JSON, ou sem nome, dão upstream', async () => {
  const done = (/** @type {object} */ item) => `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { id: 'fc_1', type: 'function_call', ...item } })}\n\n`;
  const end = 'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
  const empty = await chat(done({ call_id: 'c', name: 'hora', arguments: '' }) + end);
  assert.equal(empty.events[0].arguments, '{}');
  const bad = await chatError(done({ call_id: 'c', name: 'hora', arguments: '{"a":' }) + end);
  assert.equal(bad.type, 'upstream');
  const nameless = await chatError(done({ call_id: 'c', arguments: '{}' }) + end);
  assert.equal(nameless.type, 'upstream');
  // sem call_id, o id do item serve
  const noCall = await chat(done({ name: 'hora', arguments: '{}' }) + end);
  assert.equal(noCall.events[0].id, 'fc_1');
});

test('stream com texto e tools juntos: o texto sai antes, a tool call depois, e o fim é tool_calls', async () => {
  const { events, result } = await chat(fixture('text-and-tool.sse'), { request: { messages: hi, tools } });
  assert.deepEqual(events.slice(0, 2), [
    { type: 'text', text: 'Vou consultar.' },
    { type: 'tool_call', id: 'call_clima3', name: 'clima', arguments: '{"cidade":"Dourados"}' },
  ]);
  assert.equal(result.finishReason, 'tool_calls');
});

test('response.completed sem tool call fecha com stop, mesmo com texto antes', async () => {
  assert.equal((await chat(fixture('structured.sse'))).result.finishReason, 'stop');
});

test('response.incomplete: max_output_tokens é length; content_filter é content_filter; razão nova passa como veio; uso é lido', async () => {
  const length = await chat(fixture('incomplete-length.sse'));
  assert.deepEqual(length.events[0], { type: 'text', text: 'Era uma vez' });
  assert.equal(length.result.finishReason, 'length');
  assert.equal(length.result.usage.output, 16);
  const filter = await chat(fixture('incomplete-filter.sse'));
  assert.equal(filter.result.finishReason, 'content_filter');
  assert.equal(filter.result.usage.input, 9);
  const other = await chat('data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"nova_razao"}}}\n\n');
  assert.equal(other.result.finishReason, 'nova_razao');
  const noReason = await chat('data: {"type":"response.incomplete","response":{}}\n\n');
  assert.equal(noReason.result.finishReason, 'incomplete');
});

test('tool call cortada pelo limite de tokens dá upstream em vez de argumentos inválidos', async () => {
  const e = await chatError(fixture('tool-truncated.sse'));
  assert.equal(e.type, 'upstream');
  assert.match(e.message, /cortada/);
});

test('response.failed: o response.error vira erro tipado pelo código; antes de emitir, emitted é false', async () => {
  const e = await chatError(fixture('failed.sse'));
  assert.equal(e.name, 'ProviderError');
  assert.equal(e.type, 'rate_limit');
  assert.equal(e.status, 429);
  assert.match(e.message, /Rate limit reached/);
  assert.equal(e.emitted, true); // o texto "Começo" já tinha saído
  const codes = {
    server_error: 'upstream', invalid_api_key: 'auth', insufficient_quota: 'rate_limit',
    context_length_exceeded: 'invalid_request', invalid_prompt: 'invalid_request', '503': 'upstream',
  };
  for (const [code, type] of Object.entries(codes)) {
    const err = await chatError(`data: ${JSON.stringify({ type: 'response.failed', response: { error: { code: /^\d+$/.test(code) ? Number(code) : code, message: 'x' } } })}\n\n`);
    assert.equal(err.type, type, code);
    assert.equal(err.emitted, false);
  }
});

test('response.failed sem código ou sem error é upstream', async () => {
  const noError = await chatError(fixture('failed-no-code.sse'));
  assert.equal(noError.type, 'upstream');
  assert.equal(noError.retryOther, true);
  const noCode = await chatError('data: {"type":"response.failed","response":{"error":{"message":"deu ruim"}}}\n\n');
  assert.equal(noCode.type, 'upstream');
  assert.match(noCode.message, /deu ruim/);
});

test('evento error (campos no topo, ou aninhados em error) vira erro tipado', async () => {
  const top = await chatError(fixture('error.sse'));
  assert.equal(top.type, 'upstream');
  assert.equal(top.status, 500);
  assert.match(top.message, /server had an error/);
  const nested = await chatError('event: error\ndata: {"type":"error","error":{"type":"invalid_request_error","code":"context_length_exceeded","message":"longo demais"}}\n\n');
  assert.equal(nested.type, 'invalid_request');
  assert.match(nested.message, /longo demais/);
  const bare = await chatError('event: error\ndata: {"message":"sem tipo"}\n\n');
  assert.equal(bare.type, 'upstream');
});

test('stream que acaba sem evento final é upstream, e o que já saiu fica marcado como emitido', async () => {
  const e = await chatError(fixture('no-final.sse'));
  assert.equal(e.type, 'upstream');
  assert.match(e.message, /sem (evento final|response\.completed)/);
  assert.equal(e.emitted, true);
  const empty = await chatError('');
  assert.equal(empty.type, 'upstream');
  assert.equal(empty.emitted, false);
});

test('chunk que não é JSON é upstream; eventos que o fio não usa são ignorados', async () => {
  assert.equal((await chatError('data: {oops\n\n')).type, 'upstream');
  const sse = [
    'data: {"type":"response.queued"}\n\n',
    'data: {"type":"response.content_part.added","part":{"type":"output_text","text":""}}\n\n',
    'data: {"type":"response.output_text.delta","delta":""}\n\n',
    'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
    'data: {"type":"response.web_search_call.in_progress"}\n\n',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
  ].join('');
  const { events } = await chat(sse);
  assert.deepEqual(events.slice(0, 1), [{ type: 'text', text: 'ok' }]);
  // o tipo também vale quando só o cabeçalho `event:` o traz
  const viaHeader = await chat('event: response.output_text.delta\ndata: {"delta":"via header"}\n\nevent: response.completed\ndata: {"response":{}}\n\n');
  assert.deepEqual(viaHeader.events[0], { type: 'text', text: 'via header' });
});

test('sem uso declarado: missing, e o custo pela tabela não vira zero', async () => {
  const { result } = await chat(fixture('no-usage.sse'), { mdl: { ...model, cost: { input: 1, output: 1 } } });
  assert.equal(result.usage.missing, true);
  assert.deepEqual(result.cost, { usd: null, source: 'none' });
});

test('custo informado pelo provedor em usage.cost é usado', async () => {
  const sse = 'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":5,"cost":0.0042}}}\n\n';
  const { result } = await chat(sse, { mdl: { ...model, cost: { input: 1, output: 1 } } });
  assert.deepEqual(result.cost, { usd: 0.0042, source: 'provider' });
});

test('o pedido sai pelo cliente: URL, Bearer, headers da conta e corpo do fio', async () => {
  const f = fakeFetch(fixture('text.sse'));
  const run = createClient({ account: { ...account, headers: { 'x-extra': '1' } }, model, fetch: f }).chat({ system: 's', messages: hi, maxTokens: 50 });
  for await (const _ of run) { /* consome */ }
  assert.equal(f.last.url, 'https://api.openai.com/v1/responses');
  assert.equal(f.last.init.headers.authorization, 'Bearer sk-test');
  assert.equal(f.last.init.headers['x-extra'], '1');
  assert.deepEqual(f.last.body, {
    model: 'gpt-5.4-nano',
    input: [{ type: 'message', role: 'system', content: 's' }, { type: 'message', role: 'user', content: 'oi' }],
    stream: true,
    max_output_tokens: 50,
  });
});

test('ciclo completo: tool call, resultado devolvido com function_call_output e resposta final', async () => {
  const first = await chat(fixture('text-and-tool.sse'), { request: { messages: hi, tools } });
  const call = first.events.find((e) => e.type === 'tool_call');
  const f = fakeFetch(fixture('text.sse'));
  const run = createClient({ account, model, fetch: f }).chat({ messages: [
    ...hi,
    { role: 'assistant', content: 'Vou consultar.', toolCalls: [{ id: call.id, name: call.name, arguments: call.arguments }] },
    { role: 'tool', toolCallId: call.id, content: '31 graus' },
  ], tools });
  for await (const _ of run) { /* consome */ }
  assert.deepEqual(f.last.body.input.slice(1), [
    { type: 'message', role: 'assistant', content: 'Vou consultar.' },
    { type: 'function_call', call_id: 'call_clima3', name: 'clima', arguments: '{"cidade":"Dourados"}' },
    { type: 'function_call_output', call_id: 'call_clima3', output: '31 graus' },
  ]);
});

test('resposta real com tool call: nome, argumentos e fim tool_calls', async () => {
  const { events, result } = await chat(fixture('tool-call.sse'), { request: { messages: hi, tools } });
  const call = events.find((e) => e.type === 'tool_call');
  assert.equal(call.name, 'horas_em');
  assert.match(call.id, /^call_/);
  assert.match(JSON.parse(call.arguments).cidade, /Dourados/);
  assert.equal(result.finishReason, 'tool_calls');
});

test('resposta real com saída estruturada: JSON válido', async () => {
  const { events, result } = await chat(fixture('structured.sse'));
  const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
  assert.equal(typeof JSON.parse(text).nome, 'string');
  assert.equal(result.finishReason, 'stop');
});

test('recusa do modelo: o texto vem, e o fim é content_filter', async () => {
  const sse = [
    'data: {"type":"response.refusal.delta","delta":"Não posso ajudar."}',
    '',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}',
    '',
    '',
  ].join('\n');
  const { events, result } = await chat(sse);
  assert.deepEqual(events[0], { type: 'text', text: 'Não posso ajudar.' });
  assert.equal(result.finishReason, 'content_filter');
});

test('top_level_json_schema: schema solto no topo, para o llama.cpp', () => {
  const schema = { type: 'object', properties: {} };
  const acc = { id: 'l', provider: 'llama', api: 'openai-responses', baseUrl: 'http://x/v1', compat: { structuredOutput: 'top_level_json_schema' } };
  const { body } = buildRequest({ account: acc, model, compat: resolveCompat(acc, model), apiKey: '', request: { messages: hi, responseSchema: { schema } } });
  assert.deepEqual(body.json_schema, schema);
  assert.equal(body.text, undefined);
});

test('as operações de chamada única valem na conta openai-responses', async () => {
  const acc = { id: 'o', provider: 'openai', api: 'openai-responses', baseUrl: 'https://x/v1', apiKey: 'k' };
  const mdl = { id: 'e', operations: ['embeddings'], input: ['text'], output: ['embeddings'] };
  const f = async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }], usage: { prompt_tokens: 1 } }));
  const r = await createClient({ account: acc, model: mdl, fetch: f }).embed({ texts: ['oi'] });
  assert.deepEqual(r.vectors, [[1]]);
});

test('uso: gravação de cache sai do input, como o cache lido', async () => {
  const sse = 'data: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":1,"input_tokens_details":{"cached_tokens":30,"cache_write_tokens":20}}}}\n\n';
  const { result } = await chat(sse);
  assert.deepEqual([result.usage.input, result.usage.cacheRead, result.usage.cacheWrite], [50, 30, 20]);
});

test('sem output_item.done: a chamada sai do evento final, sem duplicar', async () => {
  const lines = [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'clima', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_1', delta: '{"cidade":"X"}' },
    { type: 'response.completed', response: { output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'clima', arguments: '{"cidade":"X"}' }], usage: { input_tokens: 1, output_tokens: 1 } } },
  ];
  const { events, result } = await chat(lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join(''), { request: { messages: hi, tools } });
  assert.deepEqual(events.filter((e) => e.type === 'tool_call'), [{ type: 'tool_call', id: 'call_1', name: 'clima', arguments: '{"cidade":"X"}' }]);
  assert.equal(result.finishReason, 'tool_calls');
});

test('com output_item.done e o evento final: uma chamada só', async () => {
  const item = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'clima', arguments: '{}' };
  const lines = [
    { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { output: [item], usage: { input_tokens: 1, output_tokens: 1 } } },
  ];
  const { events } = await chat(lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join(''), { request: { messages: hi, tools } });
  assert.equal(events.filter((e) => e.type === 'tool_call').length, 1);
});

test('chamada aberta sem fim nenhum dá upstream, não some', async () => {
  const lines = [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'clima', arguments: '' } },
    { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } },
  ];
  await assert.rejects(chat(lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join(''), { request: { messages: hi, tools } }), (e) => e.type === 'upstream');
});

test('explícito vence params: maxTokens, temperature, tool_choice e schema no topo', () => {
  const tool = [{ name: 't', parameters: { type: 'object', properties: {} } }];
  const acc = { id: 'l', provider: 'llama', api: 'openai-responses', baseUrl: 'http://x/v1', compat: { structuredOutput: 'top_level_json_schema', supportsTemperature: true } };
  const mdl = { ...model, params: { max_output_tokens: 1, temperature: 0.1, tool_choice: 'none', json_schema: { velho: true } } };
  const schema = { type: 'object', properties: {} };
  const { body } = buildRequest({ account: acc, model: mdl, compat: resolveCompat(acc, mdl), apiKey: '', request: { messages: hi, tools: tool, toolChoice: 'required', maxTokens: 50, temperature: 0.7, responseSchema: { schema } } });
  assert.deepEqual([body.max_output_tokens, body.temperature, body.tool_choice, body.json_schema], [50, 0.7, 'required', schema]);
});

test('temperature não vai por padrão neste fio', () => {
  const acc = { id: 'o', provider: 'openai', api: 'openai-responses', baseUrl: 'https://x/v1' };
  const { body } = buildRequest({ account: acc, model, compat: resolveCompat(acc, model), apiKey: '', request: { messages: hi, temperature: 0.7 } });
  assert.equal('temperature' in body, false);
});
