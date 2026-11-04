// Fio google-generative-ai: pedido (buildRequest, toGeminiContents) e stream (parseStream).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '../src/client.js';
import { resolveCompat } from '../src/compat.js';
import * as lib from '../src/index.js';
import { buildRequest, toGeminiContents } from '../src/apis/google-generative-ai.js';
import { buildRequest as openaiBuildRequest } from '../src/apis/openai-completions.js';

const account = { id: 'g', provider: 'google', api: 'google-generative-ai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'AIza-test' };
const model = { id: 'gemini-3.5-flash', operations: ['chat'], input: ['text', 'image', 'audio', 'video', 'file'], output: ['text'] };

/** Monta com o compat resolvido, como o cliente faz. */
function build(request, { acc = account, mdl = model } = {}) {
  return buildRequest({ account: acc, model: mdl, compat: resolveCompat(acc, mdl), request, apiKey: 'AIza-test' });
}
const hi = [{ role: 'user', content: 'oi' }];
const ctx = { model, provider: 'google' };

/** @param {() => unknown} fn @param {string} type @param {boolean} retryOther */
function throwsType(fn, type, retryOther) {
  assert.throws(fn, (e) => e.name === 'ProviderError' && e.type === type && e.retryOther === retryOther, `esperava ${type}`);
}

// ---------------------------------------------------------------------------------------
// registro e compat

test('o fio está registrado, tem compat próprio e exporta toGeminiContents', () => {
  assert.ok(lib.listApis().includes('google-generative-ai'));
  assert.equal(lib.toGeminiContents, toGeminiContents);
  const c = resolveCompat(account);
  assert.equal(c.structuredOutput, 'response_json_schema');
  assert.equal(c.usageInStream, true);
  assert.equal(c.cacheMarker, 'none');
});

// ---------------------------------------------------------------------------------------
// buildRequest

test('URL, chave no header x-goog-api-key e id do modelo codificado', () => {
  const r = build({ messages: hi });
  assert.equal(r.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse');
  assert.deepEqual(r.headers, { 'content-type': 'application/json', 'x-goog-api-key': 'AIza-test', accept: 'text/event-stream' });
  const odd = build({ messages: hi }, { acc: { ...account, baseUrl: 'https://x.test/v1beta//' }, mdl: { ...model, id: 'tuned/a b' } });
  assert.equal(odd.url, 'https://x.test/v1beta/models/tuned%2Fa%20b:streamGenerateContent?alt=sse');
});

test('corpo mínimo: só contents, sem generationConfig vazio', () => {
  assert.deepEqual(build({ messages: hi }).body, { contents: [{ role: 'user', parts: [{ text: 'oi' }] }] });
});

test('messages precisa ser uma lista, e papel desconhecido é invalid_request', () => {
  throwsType(() => build({ messages: 'oi' }), 'invalid_request', false);
  throwsType(() => build({ messages: [{ role: 'system', content: 'x' }] }), 'invalid_request', false);
  throwsType(() => build({ messages: [null] }), 'invalid_request', false);
});

test('user: texto simples, partes de texto e conteúdo vazio', () => {
  assert.deepEqual(toGeminiContents([{ role: 'user', content: 'a' }], ctx), [{ role: 'user', parts: [{ text: 'a' }] }]);
  assert.deepEqual(
    toGeminiContents([{ role: 'user', content: [{ type: 'text', text: 'a', cache: { ttl: '5m' } }, { type: 'text', text: 'b' }] }], ctx),
    [{ role: 'user', parts: [{ text: 'a' }, { text: 'b' }] }],
  );
  // texto vazio some quando há outra parte; sozinho, vira a parte vazia
  assert.deepEqual(
    toGeminiContents([{ role: 'user', content: [{ type: 'text', text: '' }, { type: 'text', text: 'b' }] }], ctx),
    [{ role: 'user', parts: [{ text: 'b' }] }],
  );
  assert.deepEqual(toGeminiContents([{ role: 'user', content: '' }], ctx), [{ role: 'user', parts: [{ text: '' }] }]);
  assert.deepEqual(toGeminiContents([{ role: 'user', content: [] }], ctx), [{ role: 'user', parts: [{ text: '' }] }]);
});

test('user: imagem, áudio, vídeo e arquivo com data viram inlineData, sem o prefixo data:', () => {
  const [c] = toGeminiContents([{
    role: 'user',
    content: [
      { type: 'text', text: 'olha' },
      { type: 'image', data: 'QUJD', mime: 'image/png' },
      { type: 'image', data: 'data:image/jpeg;base64,REVG' },
      { type: 'audio', data: 'QQ==', format: 'mp3' },
      { type: 'video', data: 'QQ==', mime: 'video/mp4' },
      { type: 'file', data: 'JVBERg==', mime: 'application/pdf', name: 'a.pdf' },
      { type: 'file', data: 'aGk=', mime: 'text/plain; charset=utf-8' },
    ],
  }], ctx);
  assert.deepEqual(c, {
    role: 'user',
    parts: [
      { text: 'olha' },
      { inlineData: { mimeType: 'image/png', data: 'QUJD' } },
      { inlineData: { mimeType: 'image/jpeg', data: 'REVG' } },
      { inlineData: { mimeType: 'audio/mp3', data: 'QQ==' } },
      { inlineData: { mimeType: 'video/mp4', data: 'QQ==' } },
      { inlineData: { mimeType: 'application/pdf', data: 'JVBERg==' } },
      { inlineData: { mimeType: 'text/plain', data: 'aGk=' } }, // parâmetro do mime cortado
    ],
  });
});

test('mídia por URL dá unsupported, mesmo com o modelo declarando url no transporte', () => {
  const urls = [
    { type: 'image', url: 'https://x/i.png' },
    { type: 'file', url: 'https://x/a.pdf', mime: 'application/pdf' },
    { type: 'video', url: 'https://x/v.mp4' },
  ];
  for (const part of urls) {
    throwsType(() => toGeminiContents([{ role: 'user', content: [part] }], ctx), 'unsupported', true);
  }
  const permissivo = { ...model, transport: { image: ['data-url', 'url'], file: ['data-url', 'url'] } };
  throwsType(() => toGeminiContents([{ role: 'user', content: [urls[0]] }], { model: permissivo, provider: 'google' }), 'unsupported', true);
  throwsType(() => toGeminiContents([{ role: 'user', content: [urls[1]] }], { model: permissivo, provider: 'google' }), 'unsupported', true);
});

test('mídia que o modelo não declara em input dá unsupported; parte malformada dá invalid_request', () => {
  const soTexto = { ...model, input: ['text'] };
  throwsType(() => toGeminiContents([{ role: 'user', content: [{ type: 'image', data: 'QQ==', mime: 'image/png' }] }], { model: soTexto, provider: 'google' }), 'unsupported', true);
  throwsType(() => toGeminiContents([{ role: 'user', content: [{ type: 'image', data: 'QQ==' }] }], ctx), 'invalid_request', false); // sem mime
  throwsType(() => toGeminiContents([{ role: 'user', content: [{ type: 'audio', data: 'QQ==' }] }], ctx), 'invalid_request', false); // sem format
  throwsType(() => toGeminiContents([{ role: 'user', content: [{ type: 'image', data: 'data:image/png,QUJD' }] }], ctx), 'invalid_request', false); // data-url sem base64
  // o modelo pode desligar o transporte padrão
  const semAudio = { ...model, transport: { audio: null } };
  throwsType(() => toGeminiContents([{ role: 'user', content: [{ type: 'audio', data: 'QQ==', format: 'mp3' }] }], { model: semAudio, provider: 'google' }), 'unsupported', true);
});

test('assistant: texto e functionCall, com args vindos do JSON de arguments', () => {
  const out = toGeminiContents([{
    role: 'assistant', content: 'vou ver',
    toolCalls: [{ id: 'a', name: 'clima', arguments: '{"cidade":"Campo Grande"}' }, { id: 'b', name: 'hora', arguments: '' }],
  }], ctx);
  assert.deepEqual(out, [{
    role: 'model',
    parts: [{ text: 'vou ver' }, { functionCall: { name: 'clima', args: { cidade: 'Campo Grande' } } }, { functionCall: { name: 'hora', args: {} } }],
  }]);
});

test('assistant: só tool call não leva texto vazio; sem nada leva a parte vazia', () => {
  assert.deepEqual(
    toGeminiContents([{ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'f', arguments: '{}' }] }], ctx),
    [{ role: 'model', parts: [{ functionCall: { name: 'f', args: {} } }] }],
  );
  assert.deepEqual(toGeminiContents([{ role: 'assistant', content: '' }], ctx), [{ role: 'model', parts: [{ text: '' }] }]);
  assert.deepEqual(
    toGeminiContents([{ role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }], ctx),
    [{ role: 'model', parts: [{ text: 'ab' }] }],
  );
});

test('assistant: arguments inválido, não objeto ou tool call malformada dá invalid_request', () => {
  const call = (/** @type {any} */ extra) => [{ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'f', arguments: '{}', ...extra }] }];
  throwsType(() => toGeminiContents(call({ arguments: '{"a":' }), ctx), 'invalid_request', false);
  throwsType(() => toGeminiContents(call({ arguments: '[1]' }), ctx), 'invalid_request', false);
  throwsType(() => toGeminiContents(call({ arguments: '"x"' }), ctx), 'invalid_request', false);
  throwsType(() => toGeminiContents(call({ name: '' }), ctx), 'invalid_request', false);
});

test('assistant: mídia no papel assistant dá unsupported', () => {
  throwsType(() => toGeminiContents([{ role: 'assistant', content: [{ type: 'image', data: 'QQ==', mime: 'image/png' }] }], ctx), 'unsupported', true);
});

test('tool: functionResponse com o name achado pelo toolCallId', () => {
  const out = toGeminiContents([
    { role: 'user', content: 'clima?' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'gemini-tc-0', name: 'clima', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'gemini-tc-0', content: '30 graus' },
  ], ctx);
  assert.deepEqual(out[2], { role: 'function', parts: [{ functionResponse: { name: 'clima', response: { content: '30 graus' } } }] });
});

test('tool sem chamada correspondente, sem toolCallId ou antes da chamada dá invalid_request', () => {
  throwsType(() => toGeminiContents([{ role: 'tool', toolCallId: 'x', content: 'r' }], ctx), 'invalid_request', false);
  throwsType(() => toGeminiContents([
    { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'f', arguments: '{}' }] },
    { role: 'tool', content: 'r' },
  ], ctx), 'invalid_request', false);
  // o id só vale para mensagens anteriores
  throwsType(() => toGeminiContents([
    { role: 'tool', toolCallId: 'a', content: 'r' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'f', arguments: '{}' }] },
  ], ctx), 'invalid_request', false);
});

test('ids sintéticos se repetem a cada resposta: cada resultado acha a chamada anterior mais próxima', () => {
  const out = toGeminiContents([
    { role: 'assistant', content: '', toolCalls: [{ id: 'gemini-tc-0', name: 'primeira', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'gemini-tc-0', content: 'r1' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'gemini-tc-0', name: 'segunda', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'gemini-tc-0', content: 'r2' },
  ], ctx);
  assert.equal(out[1].parts[0].functionResponse.name, 'primeira');
  assert.equal(out[3].parts[0].functionResponse.name, 'segunda');
});

test('resultados seguidos de chamadas paralelas vão num único turno, na ordem', () => {
  const out = toGeminiContents([
    { role: 'assistant', content: '', toolCalls: [{ id: 'gemini-tc-0', name: 'a', arguments: '{}' }, { id: 'gemini-tc-1', name: 'b', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'gemini-tc-1', content: 'rb' },
    { role: 'tool', toolCallId: 'gemini-tc-0', content: 'ra' },
    { role: 'user', content: 'e então?' },
  ], ctx);
  assert.equal(out.length, 3);
  assert.deepEqual(out[1], {
    role: 'function',
    parts: [
      { functionResponse: { name: 'b', response: { content: 'rb' } } },
      { functionResponse: { name: 'a', response: { content: 'ra' } } },
    ],
  });
  assert.equal(out[2].role, 'user');
});

test('tool: partes de texto se juntam; mídia no resultado dá unsupported', () => {
  const calls = { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'f', arguments: '{}' }] };
  const out = toGeminiContents([calls, { role: 'tool', toolCallId: 'a', content: [{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }] }], ctx);
  assert.deepEqual(out[1].parts[0].functionResponse.response, { content: 'xy' });
  throwsType(() => toGeminiContents([calls, { role: 'tool', toolCallId: 'a', content: [{ type: 'image', data: 'QQ==', mime: 'image/png' }] }], ctx), 'unsupported', true);
});

test('systemInstruction: texto, blocos sem separador, vazio omitido', () => {
  assert.deepEqual(build({ system: 'seja breve', messages: hi }).body.systemInstruction, { parts: [{ text: 'seja breve' }] });
  assert.deepEqual(
    build({ system: [{ text: 'um ', cache: { ttl: '1h' } }, { text: 'dois' }], messages: hi }).body.systemInstruction,
    { parts: [{ text: 'um dois' }] },
  );
  assert.equal('systemInstruction' in build({ system: '', messages: hi }).body, false);
  assert.equal('systemInstruction' in build({ system: [], messages: hi }).body, false);
});

test('tools: functionDeclarations; description só quando existe; sem propriedades, sem parameters', () => {
  const params = { type: 'object', properties: { cidade: { type: 'string' } }, required: ['cidade'] };
  const { body } = build({
    messages: hi,
    tools: [
      { name: 'clima', description: 'tempo', parameters: params },
      { name: 'sem_desc', parameters: params },
      { name: 'sem_args', description: 'não recebe nada', parameters: { type: 'object', properties: {} } },
      { name: 'sem_schema', parameters: /** @type {any} */ (undefined) },
    ],
  });
  assert.deepEqual(body.tools, [{ functionDeclarations: [
    { name: 'clima', description: 'tempo', parameters: params },
    { name: 'sem_desc', parameters: params },
    { name: 'sem_args', description: 'não recebe nada' },
    { name: 'sem_schema' },
  ] }]);
  assert.equal('tools' in build({ messages: hi, tools: [] }).body, false);
});

test('generationConfig: temperature (se o compat aceita), maxOutputTokens', () => {
  assert.deepEqual(build({ messages: hi, temperature: 0.2, maxTokens: 100 }).body.generationConfig, { temperature: 0.2, maxOutputTokens: 100 });
  const semTemp = { ...model, compat: { supportsTemperature: false } };
  assert.deepEqual(build({ messages: hi, temperature: 0.2, maxTokens: 100 }, { mdl: semTemp }).body.generationConfig, { maxOutputTokens: 100 });
  assert.equal('generationConfig' in build({ messages: hi, temperature: 0.2 }, { mdl: semTemp }).body, false);
  // o teto do modelo não é valor a enviar
  assert.equal('generationConfig' in build({ messages: hi }, { mdl: { ...model, maxTokens: 8192 } }).body, false);
});

test('responseSchema: mimeType + responseJsonSchema; outro structuredOutput dá unsupported', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } } };
  assert.deepEqual(
    build({ messages: hi, maxTokens: 50, responseSchema: { name: 'x', schema, strict: true } }).body.generationConfig,
    { maxOutputTokens: 50, responseMimeType: 'application/json', responseJsonSchema: schema },
  );
  for (const structuredOutput of ['none', 'response_format']) {
    const acc = { ...account, compat: { structuredOutput } };
    throwsType(() => build({ messages: hi, responseSchema: { schema } }, { acc }), 'unsupported', true);
  }
});

test('cachedContent: vai no corpo e o generationConfig continua indo', () => {
  const schema = { type: 'object' };
  const { body } = build({ messages: hi, cachedContent: 'cachedContents/abc', temperature: 0.1, responseSchema: { schema } });
  assert.equal(body.cachedContent, 'cachedContents/abc');
  assert.equal('systemInstruction' in body, false);
  assert.equal('tools' in body, false);
  assert.deepEqual(body.generationConfig, { temperature: 0.1, responseMimeType: 'application/json', responseJsonSchema: schema });
});

test('cachedContent com system ou tools dá invalid_request, sem outro alvo', () => {
  throwsType(() => build({ messages: hi, cachedContent: 'cachedContents/abc', system: 'fixo' }), 'invalid_request', false);
  throwsType(() => build({ messages: hi, cachedContent: 'cachedContents/abc', system: [{ text: 'fixo' }] }), 'invalid_request', false);
  throwsType(() => build({ messages: hi, cachedContent: 'cachedContents/abc', tools: [{ name: 'f', parameters: { type: 'object' } }] }), 'invalid_request', false);
  // system vazio e lista de tools vazia não contam
  assert.equal(build({ messages: hi, cachedContent: 'cachedContents/abc', system: '', tools: [] }).body.cachedContent, 'cachedContents/abc');
});

test('params: modelo, depois pedido; protegidos ficam; generationConfig se funde', () => {
  const mdl = { ...model, params: { safetySettings: [1], generationConfig: { topP: 0.9 }, cachedContent: 'x' } };
  const { body } = build({
    messages: hi, maxTokens: 10,
    params: { safetySettings: [2], contents: 'lixo', systemInstruction: 'lixo', tools: 'lixo', cachedContent: 'lixo', generationConfig: { thinkingConfig: { includeThoughts: true }, maxOutputTokens: 99 } },
  }, { mdl });
  assert.deepEqual(body.safetySettings, [2]);
  assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'oi' }] }]);
  for (const k of ['systemInstruction', 'tools', 'cachedContent']) assert.equal(k in body, false, k);
  assert.deepEqual(body.generationConfig, { maxOutputTokens: 99, topP: 0.9, thinkingConfig: { includeThoughts: true } });
});

// ---------------------------------------------------------------------------------------
// stream

const fixture = (/** @type {string} */ name) => readFileSync(new URL(`./fixtures/google-generative-ai/${name}`, import.meta.url), 'utf8');

/** fetch falso: devolve o texto SSE de uma vez e guarda o último pedido. */
function fakeFetch(/** @type {string} */ sse, headers = {}) {
  const fn = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    fn.last = { url, init, body: JSON.parse(init.body) };
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } });
  });
  return fn;
}

/** Roda o chat inteiro e devolve eventos + resultado, ou lança o erro. */
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

test('texto: eventos, uso (o último usageMetadata vence) e fim stop', async () => {
  const { events, result } = await chat(fixture('text.sse'), { mdl: { ...model, cost: { input: 1, output: 2 } } });
  assert.deepEqual(events.slice(0, 2), [{ type: 'text', text: 'Olá' }, { type: 'text', text: ', mundo!' }]);
  assert.equal(events.length, 3);
  assert.equal(events[2].type, 'end');
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual({ ...result.usage, raw: undefined }, { input: 8, output: 4, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, raw: undefined });
  assert.equal(/** @type {any} */ (result.usage.raw).totalTokenCount, 12);
  assert.deepEqual(result.cost, { usd: 0.000016, source: 'table' });
});

test('pensamento: part.thought vira reasoning; os tokens de pensamento entram na saída', async () => {
  const { events, result } = await chat(fixture('thought.sse'));
  assert.deepEqual(events.slice(0, 3), [
    { type: 'reasoning', text: '**Somando**\n\nPreciso somar 2 e 2.' },
    { type: 'text', text: 'A resposta é ' },
    { type: 'text', text: '4.' },
  ]);
  assert.equal(result.usage.output, 31);
  assert.equal(result.usage.reasoning, 26);
  assert.equal(result.finishReason, 'stop');
});

test('tool call: ids gemini-tc-N, arguments em JSON, fim tool_calls', async () => {
  const { events, result } = await chat(fixture('tool-call.sse'));
  assert.deepEqual(events.slice(0, 2), [
    { type: 'tool_call', id: 'gemini-tc-0', name: 'clima', arguments: '{"cidade":"Campo Grande"}' },
    { type: 'tool_call', id: 'gemini-tc-1', name: 'hora', arguments: '{}' },
  ]);
  assert.equal(result.finishReason, 'tool_calls');
  // a contagem recomeça a cada resposta
  const again = await chat(fixture('tool-call.sse'));
  assert.equal(again.events[0].id, 'gemini-tc-0');
});

test('tool call sem args no chunk vira {}', async () => {
  const sse = 'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"f"}}],"role":"model"},"finishReason":"STOP"}]}\n\n';
  const { events } = await chat(sse);
  assert.equal(events[0].arguments, '{}');
});

test('functionCall sem nome é upstream, nunca uma tool call vazia', async () => {
  const e = await chatError('data: {"candidates":[{"content":{"parts":[{"functionCall":{"args":{}}}],"role":"model"},"finishReason":"STOP"}]}\n\n');
  assert.equal(e.type, 'upstream');
  assert.match(e.message, /sem nome/);
});

test('finishReason: MAX_TOKENS → length, mesmo com tool call; SAFETY e RECITATION → content_filter', async () => {
  assert.equal((await chat(fixture('max-tokens.sse'))).result.finishReason, 'length');
  const call = (/** @type {string} */ reason) => `data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"f","args":{}}}],"role":"model"},"finishReason":"${reason}"}]}\n\n`;
  assert.equal((await chat(call('MAX_TOKENS'))).result.finishReason, 'length');
  assert.equal((await chat(call('STOP'))).result.finishReason, 'tool_calls');
  assert.equal((await chat(call('RECITATION'))).result.finishReason, 'content_filter');
  const safety = await chat(fixture('safety.sse'));
  assert.deepEqual(safety.events[0], { type: 'text', text: 'Claro, o primeiro passo é' }); // o que veio antes do corte fica
  assert.equal(safety.result.finishReason, 'content_filter');
});

test('outro finishReason passa em minúsculas', async () => {
  const sse = (/** @type {string} */ r) => `data: {"candidates":[{"content":{"parts":[{"text":"x"}],"role":"model"},"finishReason":"${r}"}]}\n\n`;
  assert.equal((await chat(sse('MALFORMED_FUNCTION_CALL'))).result.finishReason, 'malformed_function_call');
  assert.equal((await chat(sse('BLOCKLIST'))).result.finishReason, 'blocklist');
});

test('prompt bloqueado (promptFeedback.blockReason, sem candidatos) é content_filter', async () => {
  const { events, result } = await chat(fixture('blocked.sse'));
  assert.deepEqual(events.map((e) => e.type), ['end']);
  assert.equal(result.finishReason, 'content_filter');
  assert.equal(result.usage.input, 15);
});

test('erro dentro do stream vira ProviderError tipado pelo code, com emitted', async () => {
  const e = await chatError(fixture('error-mid.sse'));
  assert.equal(e.name, 'ProviderError');
  assert.equal(e.type, 'upstream');
  assert.equal(e.status, 503);
  assert.equal(e.retryOther, true);
  assert.equal(e.emitted, true); // já saiu texto
  assert.match(e.message, /overloaded/);

  const first = await chatError('data: {"error":{"code":429,"message":"cota","status":"RESOURCE_EXHAUSTED"}}\n\n');
  assert.equal(first.type, 'rate_limit');
  assert.equal(first.emitted, false);
  // sem code numérico: o status textual do Google decide; sem nada, 500
  assert.equal((await chatError('data: {"error":{"message":"x","status":"UNAUTHENTICATED"}}\n\n')).type, 'auth');
  assert.equal((await chatError('data: {"error":{"message":"x"}}\n\n')).status, 500);
  assert.equal((await chatError('data: {"error":{"code":400,"message":"ruim","status":"INVALID_ARGUMENT"}}\n\n')).type, 'invalid_request');
});

test('stream sem finishReason é upstream, como o openai-completions sem finish_reason nem [DONE]', async () => {
  const e = await chatError(fixture('no-finish.sse'));
  assert.equal(e.type, 'upstream');
  assert.equal(e.retryOther, true);
  assert.match(e.message, /finishReason/);
  assert.equal(e.emitted, true);
  const vazio = await chatError('');
  assert.equal(vazio.type, 'upstream');
  assert.equal(vazio.emitted, false);
  // FINISH_REASON_UNSPECIFIED não conta como fim
  const unspecified = 'data: {"candidates":[{"content":{"parts":[{"text":"x"}],"role":"model"},"finishReason":"FINISH_REASON_UNSPECIFIED"}]}\n\n';
  assert.equal((await chatError(unspecified)).type, 'upstream');
});

test('chunk que não é JSON é upstream', async () => {
  const e = await chatError('data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\n\ndata: isto não é json\n\n');
  assert.equal(e.type, 'upstream');
  assert.match(e.message, /JSON/);
  assert.equal(e.body, 'isto não é json');
});

test('uso com cache: input sem o cache lido, cacheRead separado, custo pela tabela', async () => {
  const mdl = { ...model, cost: { input: 1, output: 2, cacheRead: 0.1 } };
  const { result } = await chat(fixture('cached.sse'), { mdl });
  assert.equal(result.usage.input, 904);
  assert.equal(result.usage.cacheRead, 4096);
  assert.equal(result.usage.output, 7);
  assert.equal(result.usage.reasoning, undefined); // thoughtsTokenCount ausente: sem campo
  assert.deepEqual(result.cost, { usd: (904 * 1 + 7 * 2 + 4096 * 0.1) / 1e6, source: 'table' });
});

test('sem usageMetadata: uso missing, custo none (nunca US$ 0)', async () => {
  const { result } = await chat(fixture('no-usage.sse'), { mdl: { ...model, cost: { input: 1, output: 1 } } });
  assert.equal(result.usage.missing, true);
  assert.deepEqual(result.cost, { usd: null, source: 'none' });
});

test('partes que o fio não lê (código executável, texto vazio) são ignoradas quando a resposta tem conteúdo', async () => {
  const sse = 'data: {"candidates":[{"content":{"parts":[{"text":""},{"executableCode":{"language":"PYTHON","code":"1+1"}},{"text":"ok"}],"role":"model"},"finishReason":"STOP"}]}\n\n';
  const { events } = await chat(sse);
  assert.deepEqual(events.slice(0, 1), [{ type: 'text', text: 'ok' }]);
});

test('o pedido sai pelo cliente com a chave no header e o corpo do fio', async () => {
  const f = fakeFetch(fixture('text.sse'));
  const run = createClient({ account: { ...account, headers: { 'x-extra': '1' } }, model, fetch: f }).chat({ system: 's', messages: hi });
  for await (const _ of run) { /* consome */ }
  assert.equal(f.last.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse');
  assert.equal(f.last.init.headers['x-goog-api-key'], 'AIza-test');
  assert.equal(f.last.init.headers['x-extra'], '1');
  assert.deepEqual(f.last.body.systemInstruction, { parts: [{ text: 's' }] });
});

// ---------------------------------------------------------------------------------------
// correções da revisão da Fase 3

test('Gemini: áudio e vídeo em data-url dispensam format e mime', () => {
  const [c] = toGeminiContents([{ role: 'user', content: [
    { type: 'audio', data: 'data:audio/mp3;base64,QQ==' },
    { type: 'video', data: 'data:video/mp4;base64,Qg==' },
    { type: 'audio', data: 'data:audio/wav;base64,Qw==', format: 'mp3' }, // o prefixo vence, como em image e file
  ] }], ctx);
  assert.deepEqual(c.parts, [
    { inlineData: { mimeType: 'audio/mp3', data: 'QQ==' } },
    { inlineData: { mimeType: 'video/mp4', data: 'Qg==' } },
    { inlineData: { mimeType: 'audio/wav', data: 'Qw==' } },
  ]);
  throwsType(() => toGeminiContents([{ role: 'user', content: [{ type: 'audio', data: 'data:;base64,QQ==' }] }], ctx), 'invalid_request', false);
});

/** Chunk de uma resposta só com as partes dadas e o finishReason. */
const withParts = (/** @type {unknown[]} */ parts, reason = 'STOP') =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts, role: 'model' }, finishReason: reason }] })}\n\n`;

test('resposta só com partes que o fio não modela dá unsupported, dizendo qual veio', async () => {
  const casos = [
    [{ inlineData: { mimeType: 'image/png', data: 'QQ==' } }, 'inlineData'],
    [{ executableCode: { language: 'PYTHON', code: '1+1' } }, 'executableCode'],
    [{ codeExecutionResult: { outcome: 'OUTCOME_OK', output: '2' } }, 'codeExecutionResult'],
  ];
  for (const [part, nome] of casos) {
    const e = await chatError(withParts([part]));
    assert.equal(e.type, 'unsupported', nome);
    assert.equal(e.retryOther, true);
    assert.equal(e.emitted, false);
    assert.match(e.message, new RegExp(nome));
  }
  // vale também para length; thoughtSignature e texto vazio sozinhos não são parte desconhecida
  assert.equal((await chatError(withParts([{ inlineData: { mimeType: 'image/png', data: 'QQ==' } }], 'MAX_TOKENS'))).type, 'unsupported');
  assert.equal((await chat(withParts([{ text: '', thoughtSignature: 'abc' }]))).result.finishReason, 'stop');
  assert.equal((await chat(withParts([{ thoughtSignature: 'abc' }]))).result.finishReason, 'stop');
});

test('parte desconhecida com algo emitido, ou com content_filter, é ignorada', async () => {
  const inline = { inlineData: { mimeType: 'image/png', data: 'QQ==' } };
  const a = await chat(withParts([{ text: 'legenda' }, inline]));
  assert.deepEqual(a.events[0], { type: 'text', text: 'legenda' });
  assert.equal(a.result.finishReason, 'stop');
  const b = await chat(withParts([{ functionCall: { name: 'f', args: {} } }, inline]));
  assert.equal(b.result.finishReason, 'tool_calls');
  const c = await chat(withParts([{ thought: true, text: 'pensando' }, inline]));
  assert.equal(c.events[0].type, 'reasoning');
  const d = await chat(withParts([inline], 'SAFETY'));
  assert.equal(d.result.finishReason, 'content_filter');
  // emitido em chunk anterior também conta
  const e = await chat(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'a' }] } }] })}\n\n${withParts([inline])}`);
  assert.equal(e.result.finishReason, 'stop');
});

test('parameters só some quando o schema é um objeto vazio de verdade', () => {
  const tool = (/** @type {any} */ parameters) => build({ messages: hi, tools: [{ name: 'f', parameters }] }).body.tools[0].functionDeclarations[0];
  assert.equal('parameters' in tool({ type: 'object' }), false);
  assert.equal('parameters' in tool({ type: 'object', properties: {} }), false);
  for (const schema of [
    { type: 'object', required: ['a'] },
    { type: 'object', properties: {}, required: [] },
    { type: 'object', $defs: { x: { type: 'string' } } },
    { type: 'object', additionalProperties: false },
    { type: 'object', $schema: 'http://json-schema.org/draft-07/schema#' },
    { type: 'string' },
  ]) assert.deepEqual(tool(schema).parameters, schema);
});

test('usage.reasoning fica ausente com thoughtsTokenCount 0 ou ausente', async () => {
  const chunk = (/** @type {object} */ u) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }], usageMetadata: u })}\n\n`;
  assert.equal('reasoning' in (await chat(chunk({ promptTokenCount: 3, candidatesTokenCount: 1, thoughtsTokenCount: 0 }))).result.usage, false);
  assert.equal('reasoning' in (await chat(chunk({ promptTokenCount: 3, candidatesTokenCount: 1 }))).result.usage, false);
  assert.equal((await chat(chunk({ promptTokenCount: 3, candidatesTokenCount: 1, thoughtsTokenCount: 5 }))).result.usage.reasoning, 5);
});

test('params.generationConfig que não é objeto dá invalid_request, não some', () => {
  for (const generationConfig of [null, 'x', 3, [1]]) {
    throwsType(() => build({ messages: hi, params: { generationConfig } }), 'invalid_request', false);
    throwsType(() => build({ messages: hi }, { mdl: { ...model, params: { generationConfig } } }), 'invalid_request', false);
  }
  assert.equal('generationConfig' in build({ messages: hi, params: { generationConfig: undefined } }).body, false);
});

function openaiBuild(/** @type {any} */ request) {
  const acc = { id: 'o', provider: 'acme', api: 'openai-completions', baseUrl: 'https://acme.test/v1', apiKey: 'k' };
  const mdl = { id: 'm', operations: ['chat'], input: ['text'], output: ['text'] };
  return openaiBuildRequest({ account: /** @type {any} */ (acc), model: /** @type {any} */ (mdl), compat: resolveCompat(acc, mdl), request, apiKey: 'k' });
}

test('tool com toolName: o nome vem da mensagem, mesmo sem a chamada na lista', () => {
  // sufixo depois de um cachedContent: a chamada ficou no prefixo cacheado
  const out = toGeminiContents([
    { role: 'tool', toolCallId: 'gemini-tc-0', toolName: 'clima', content: '30 graus' },
    { role: 'user', content: 'e agora?' },
  ], ctx);
  assert.deepEqual(out[0], { role: 'function', parts: [{ functionResponse: { name: 'clima', response: { content: '30 graus' } } }] });
  // toolName vence o mapa; sem toolCallId, toolName basta
  const mapa = toGeminiContents([
    { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'do_mapa', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'a', toolName: 'da_mensagem', content: 'r' },
    { role: 'tool', toolName: 'so_nome', content: 'r2' },
  ], ctx);
  assert.deepEqual(mapa[1].parts.map((p) => p.functionResponse.name), ['da_mensagem', 'so_nome']);
  // nenhum dos dois: continua invalid_request
  throwsType(() => toGeminiContents([{ role: 'tool', toolCallId: 'x', content: 'r' }], ctx), 'invalid_request', false);
  throwsType(() => toGeminiContents([{ role: 'tool', content: 'r' }], ctx), 'invalid_request', false);
  // os outros fios ignoram o campo
  const oa = openaiBuild({ messages: [{ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'f', arguments: '{}' }] }, { role: 'tool', toolCallId: 'a', toolName: 'f', content: 'r' }] });
  assert.deepEqual(oa.body.messages[1], { role: 'tool', tool_call_id: 'a', content: 'r' });
});
