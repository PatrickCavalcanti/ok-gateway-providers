// Fio google-generative-ai: pedido (buildRequest, toGeminiContents) e stream (parseStream).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '../src/client.js';
import { resolveCompat } from '../src/compat.js';
import * as lib from '../src/index.js';
import { buildRequest, toGeminiContents } from '../src/apis/google-generative-ai.js';
import { buildRequest as openaiBuildRequest } from '../src/apis/openai-completions.js';
import { buildRequest as anthropicBuildRequest } from '../src/apis/anthropic-messages.js';

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
  ] }], ctx);
  assert.deepEqual(c.parts, [
    { inlineData: { mimeType: 'audio/mp3', data: 'QQ==' } },
    { inlineData: { mimeType: 'video/mp4', data: 'Qg==' } },
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

test('parameters some quando o schema não declara nada que restrinja', () => {
  const tool = (/** @type {any} */ parameters) => build({ messages: hi, tools: [{ name: 'f', parameters }] }).body.tools[0].functionDeclarations[0];
  for (const schema of [
    { type: 'object' },
    { type: 'object', properties: {} },
    { type: 'object', required: [] },
    { type: 'object', properties: {}, required: [] },
    { type: 'object', properties: {}, additionalProperties: false },
    { type: 'object', additionalProperties: true },
    { type: 'object', $schema: 'http://json-schema.org/draft-07/schema#', properties: {}, additionalProperties: false },
  ]) assert.equal('parameters' in tool(schema), false, JSON.stringify(schema));
  for (const schema of [
    { type: 'object', required: ['a'] },
    { type: 'object', properties: { a: { type: 'string' } } },
    { type: 'object', $defs: { x: { type: 'string' } } },
    { type: 'object', oneOf: [{ properties: { a: {} } }] },
    { type: 'object', additionalProperties: { type: 'string' } }, // mapa com valor tipado restringe
    { type: 'string' },
  ]) assert.deepEqual(tool(schema).parameters, schema);
});

test('Gemini: format e mime explícitos vencem o prefixo do data-url', () => {
  const [c] = toGeminiContents([{ role: 'user', content: [
    { type: 'audio', data: 'data:audio/wav;base64,Qw==', format: 'mp3' },
    { type: 'video', data: 'data:video/quicktime;base64,Qg==', mime: 'video/mp4' },
    { type: 'image', data: 'data:image/jpeg;base64,REVG', mime: 'image/png' },
  ] }], ctx);
  assert.deepEqual(c.parts.map((p) => p.inlineData.mimeType), ['audio/mp3', 'video/mp4', 'image/png']);
});

test('data-url vazio ou sem base64 em áudio e vídeo dá invalid_request', () => {
  for (const data of ['data:audio/mp3,QQ%3D%3D', 'data:audio/mp3', 'data:audio/mp3;base64,']) {
    throwsType(() => toGeminiContents([{ role: 'user', content: [{ type: 'audio', data, format: 'mp3' }] }], ctx), 'invalid_request', false);
  }
});

test('toolName que não é texto não vazio dá invalid_request', () => {
  const calls = { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'f', arguments: '{}' }] };
  for (const toolName of ['', '  ', 3, null, {}]) {
    throwsType(() => toGeminiContents([calls, { role: 'tool', toolCallId: 'a', toolName: /** @type {any} */ (toolName), content: 'r' }], ctx), 'invalid_request', false);
  }
  // ausente continua valendo: o nome sai do mapa
  assert.equal(toGeminiContents([calls, { role: 'tool', toolCallId: 'a', content: 'r' }], ctx)[1].parts[0].functionResponse.name, 'f');
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

// ---------------------------------------------------------------------------------------
// T1.2 · Fase 4 · Task 4.1 — toolChoice, stop, reasoning e isError

const toolDefs = [{ name: 'clima', parameters: { type: 'object' } }];

test('toolChoice: auto · none · required · { name } viram toolConfig.functionCallingConfig', () => {
  const config = (toolChoice) => build({ messages: hi, tools: toolDefs, toolChoice }).body.toolConfig;
  assert.deepEqual(config('auto'), { functionCallingConfig: { mode: 'AUTO' } });
  assert.deepEqual(config('none'), { functionCallingConfig: { mode: 'NONE' } });
  assert.deepEqual(config('required'), { functionCallingConfig: { mode: 'ANY' } });
  assert.deepEqual(config({ name: 'clima' }), { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['clima'] } });
  assert.equal('toolConfig' in build({ messages: hi, tools: toolDefs }).body, false);
});

test('toolChoice sem tools, ou com valor que não existe, é invalid_request sem outro alvo', () => {
  for (const toolChoice of ['auto', 'none', 'required', { name: 'clima' }]) {
    throwsType(() => build({ messages: hi, toolChoice }), 'invalid_request', false);
    throwsType(() => build({ messages: hi, tools: [], toolChoice }), 'invalid_request', false);
  }
  for (const toolChoice of ['sempre', {}, { name: '' }, { name: 3 }, null, 7]) {
    throwsType(() => build({ messages: hi, tools: toolDefs, toolChoice }), 'invalid_request', false);
  }
  // com cachedContent as tools vivem no cache e o toolConfig é proibido junto: também invalid_request
  throwsType(() => build({ messages: hi, cachedContent: 'cachedContents/abc', toolChoice: 'auto' }), 'invalid_request', false);
});

test('stop vira generationConfig.stopSequences e se funde com o resto; lista vazia não vai', () => {
  assert.deepEqual(build({ messages: hi, stop: ['FIM'], maxTokens: 9 }).body.generationConfig, { maxOutputTokens: 9, stopSequences: ['FIM'] });
  assert.equal('generationConfig' in build({ messages: hi, stop: [] }).body, false);
  for (const stop of ['FIM', [1], [null], {}]) throwsType(() => build({ messages: hi, stop }), 'invalid_request', false);
  // com cachedContent o stop continua valendo: é generationConfig, não vive no cache
  assert.deepEqual(build({ messages: hi, cachedContent: 'cachedContents/abc', stop: ['x'] }).body.generationConfig, { stopSequences: ['x'] });
});

test('reasoning.maxTokens e exclude dão unsupported; reasoning vazio não pede nada', () => {
  for (const reasoning of [{ maxTokens: 1000 }, { exclude: true }, { exclude: false }]) {
    throwsType(() => build({ messages: hi, effort: 'high', reasoning }), 'unsupported', true);
    throwsType(() => build({ messages: hi, reasoning }), 'unsupported', true);
  }
  assert.deepEqual(build({ messages: hi, reasoning: {} }).body, { contents: [{ role: 'user', parts: [{ text: 'oi' }] }] });
});

test('isError no papel tool: functionResponse.response vira { error: texto }; sem a marca, { content }', () => {
  const out = toGeminiContents([
    { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'f', arguments: '{}' }, { id: 'b', name: 'g', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'a', content: 'falhou', isError: true },
    { role: 'tool', toolCallId: 'b', content: [{ type: 'text', text: 'ok' }], isError: false },
  ], ctx);
  assert.deepEqual(out[1].parts, [
    { functionResponse: { name: 'f', response: { error: 'falhou' } } },
    { functionResponse: { name: 'g', response: { content: 'ok' } } },
  ]);
  // vale também quando o nome vem de toolName
  assert.deepEqual(toGeminiContents([{ role: 'tool', toolName: 'f', content: 'x', isError: true }], ctx)[0].parts[0].functionResponse.response, { error: 'x' });
});

// ---------------------------------------------------------------------------------------
// T1.2 · Fase 4 · Task 4.2 — raciocínio assinado: thoughtSignature na tool call

test('stream: thoughtSignature junto de functionCall vira providerData da tool_call; sem ela, a chave não existe', async () => {
  const { events, result } = await chat(withParts([
    { functionCall: { name: 'clima', args: { cidade: 'Campo Grande' } }, thoughtSignature: 'SIG-G1' },
    { functionCall: { name: 'hora', args: {} } },
  ]));
  assert.deepEqual(events.slice(0, 2), [
    { type: 'tool_call', id: 'gemini-tc-0', name: 'clima', arguments: '{"cidade":"Campo Grande"}', providerData: { thoughtSignature: 'SIG-G1' } },
    { type: 'tool_call', id: 'gemini-tc-1', name: 'hora', arguments: '{}' },
  ]);
  assert.equal('providerData' in events[1], false);
  assert.equal(result.finishReason, 'tool_calls');
});

test('stream: thoughtSignature vazia ou que não é texto não vira providerData', async () => {
  for (const thoughtSignature of ['', 7, null, {}]) {
    const { events } = await chat(withParts([{ functionCall: { name: 'f', args: {} }, thoughtSignature }]));
    assert.equal('providerData' in events[0], false, JSON.stringify(thoughtSignature));
  }
});

test('stream: thoughtSignature fora de functionCall segue sendo metadado, não parte desconhecida', async () => {
  // na parte de texto: o texto sai e a assinatura não vira evento nenhum
  const a = await chat(withParts([{ text: 'oi', thoughtSignature: 'SIG-T' }]));
  assert.deepEqual(a.events[0], { type: 'text', text: 'oi' });
  assert.equal(a.events.length, 2);
  // sozinha, ou ao lado de uma chamada: a resposta não é "vazia fingindo sucesso"
  assert.equal((await chat(withParts([{ thoughtSignature: 'SIG-T' }]))).result.finishReason, 'stop');
  const b = await chat(withParts([{ thoughtSignature: 'SIG-T' }, { functionCall: { name: 'f', args: {} }, thoughtSignature: 'SIG-F' }]));
  assert.equal(b.events[0].providerData.thoughtSignature, 'SIG-F');
  // a assinatura não esconde uma parte que o fio não lê: segue unsupported
  const e = await chatError(withParts([{ inlineData: { mimeType: 'image/png', data: 'QQ==' }, thoughtSignature: 'SIG-I' }]));
  assert.equal(e.type, 'unsupported');
  assert.match(e.message, /inlineData/);
});

test('pedido: providerData.thoughtSignature volta na parte functionCall, ao lado dela', () => {
  const out = toGeminiContents([{
    role: 'assistant', content: 'vou ver',
    toolCalls: [
      { id: 'a', name: 'clima', arguments: '{"cidade":"x"}', providerData: { thoughtSignature: 'SIG-G1' } },
      { id: 'b', name: 'hora', arguments: '{}' },
    ],
  }], ctx);
  assert.deepEqual(out[0].parts, [
    { text: 'vou ver' },
    { functionCall: { name: 'clima', args: { cidade: 'x' } }, thoughtSignature: 'SIG-G1' },
    { functionCall: { name: 'hora', args: {} } },
  ]);
});

test('pedido: providerData sem thoughtSignature em texto não é enviado (chave alheia, vazia ou de outro tipo)', () => {
  const parts = (providerData) => toGeminiContents([{ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'f', arguments: '{}', providerData }] }], ctx)[0].parts[0];
  for (const providerData of [{ outraCoisa: 'x' }, { thoughtSignature: '' }, { thoughtSignature: 7 }, { thoughtSignature: { a: 1 } }, {}, null, undefined]) {
    assert.deepEqual(parts(providerData), { functionCall: { name: 'f', args: {} } }, JSON.stringify(providerData));
  }
});

test('pedido: parte reasoning no papel assistant é ignorada, venha de onde vier (Anthropic assinada, redigida, sem assinatura)', () => {
  const out = toGeminiContents([{
    role: 'assistant',
    content: [
      { type: 'reasoning', text: 'pensei', signature: 'SIG-ANTHROPIC' },
      { type: 'text', text: 'a' },
      { type: 'reasoning', text: '', redacted: 'RED-ANTHROPIC' },
      { type: 'reasoning', text: 'sem assinatura' },
      { type: 'text', text: 'b' },
    ],
    toolCalls: [{ id: 'x', name: 'f', arguments: '{}' }],
  }], ctx);
  assert.deepEqual(out[0].parts, [{ text: 'ab' }, { functionCall: { name: 'f', args: {} } }]);
  const json = JSON.stringify(out);
  for (const vazou of ['SIG-ANTHROPIC', 'RED-ANTHROPIC', 'pensei', 'thought']) assert.equal(json.includes(vazou), false, vazou);
  // só raciocínio, sem texto nem chamada: a parte vazia de sempre
  assert.deepEqual(toGeminiContents([{ role: 'assistant', content: [{ type: 'reasoning', text: 'x', signature: 's' }] }], ctx), [{ role: 'model', parts: [{ text: '' }] }]);
});

test('pedido: parte reasoning fora do papel assistant continua sendo erro (user: tipo desconhecido; tool: só texto)', () => {
  const part = { type: 'reasoning', text: 'x', signature: 's' };
  throwsType(() => toGeminiContents([{ role: 'user', content: [part] }], ctx), 'invalid_request', false);
  throwsType(() => toGeminiContents([
    { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'f', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'a', content: [part] },
  ], ctx), 'unsupported', true);
});

test('ciclo: a assinatura lida na tool_call volta, pelo cliente, no functionCall do pedido seguinte', async () => {
  const f = fakeFetch(withParts([{ functionCall: { name: 'clima', args: { cidade: 'CG' } }, thoughtSignature: 'SIG-CICLO' }]));
  const client = createClient({ account, model, fetch: f });
  const run = client.chat({ messages: hi, tools: toolDefs });
  const events = [];
  for await (const ev of run) events.push(ev);
  const call = events.find((e) => e.type === 'tool_call');
  const run2 = client.chat({
    tools: toolDefs,
    messages: [
      hi[0],
      { role: 'assistant', content: '', toolCalls: [{ id: call.id, name: call.name, arguments: call.arguments, providerData: call.providerData }] },
      { role: 'tool', toolCallId: call.id, content: '30 graus' },
    ],
  });
  for await (const _ of run2) { /* consome */ }
  assert.deepEqual(f.last.body.contents[1], {
    role: 'model', parts: [{ functionCall: { name: 'clima', args: { cidade: 'CG' } }, thoughtSignature: 'SIG-CICLO' }],
  });
  assert.equal(f.last.body.contents[2].role, 'function'); // TOOL_RESULT_ROLE não mudou
});

// ---------------------------------------------------------------------------------------
// Fallback entre fios: a mesma conversa, com raciocínio e tool calls de dois provedores, vai para os três

test('fallback: raciocínio da Anthropic e assinatura do Gemini só voltam ao fio que os emitiu; ninguém recebe o do outro', () => {
  const messages = [
    { role: 'user', content: 'clima em Campo Grande?' },
    { // veio da Anthropic
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'vou consultar', signature: 'SIG-ANTHROPIC' },
        { type: 'reasoning', text: '', redacted: 'RED-ANTHROPIC' },
        { type: 'text', text: 'Consultando.' },
      ],
      toolCalls: [{ id: 'toolu_1', name: 'clima', arguments: '{"cidade":"CG"}' }],
    },
    { role: 'tool', toolCallId: 'toolu_1', content: 'timeout', isError: true },
    { // veio do Gemini
      role: 'assistant', content: 'Tentando de novo.',
      toolCalls: [{ id: 'gemini-tc-0', name: 'clima', arguments: '{"cidade":"CG"}', providerData: { thoughtSignature: 'SIG-GEMINI' } }],
    },
    { role: 'tool', toolCallId: 'gemini-tc-0', content: '30 graus' },
    { role: 'user', content: 'e agora?' },
  ];
  const request = { messages, tools: toolDefs, toolChoice: 'auto', stop: ['FIM'] };
  const mdl = { id: 'm', operations: ['chat'], input: ['text'], output: ['text'] };
  const accOpenai = { id: 'o', provider: 'openrouter', api: 'openai-completions', baseUrl: 'https://x.test/v1', apiKey: 'k' };
  const accAnthropic = { id: 'a', provider: 'anthropic', api: 'anthropic-messages', baseUrl: 'https://x.test/v1', apiKey: 'k' };
  const from = (/** @type {any} */ fio, /** @type {any} */ acc) => fio({ account: acc, model: mdl, compat: resolveCompat(acc, mdl), request, apiKey: 'k' }).body;
  const alheio = ['SIG-ANTHROPIC', 'RED-ANTHROPIC', 'vou consultar', 'SIG-GEMINI', 'providerData', 'thoughtSignature', 'isError'];

  // openai-completions: nenhum dos dois; o erro da tool vai no texto
  const o = from(openaiBuildRequest, accOpenai);
  assert.deepEqual(o.messages.slice(1, 4), [
    { role: 'assistant', content: 'Consultando.', tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'clima', arguments: '{"cidade":"CG"}' } }] },
    { role: 'tool', tool_call_id: 'toolu_1', content: 'Tool error: timeout' },
    { role: 'assistant', content: 'Tentando de novo.', tool_calls: [{ id: 'gemini-tc-0', type: 'function', function: { name: 'clima', arguments: '{"cidade":"CG"}' } }] },
  ]);
  assert.equal(o.tool_choice, 'auto');
  assert.deepEqual(o.stop, ['FIM']);
  for (const s of alheio) assert.equal(JSON.stringify(o).includes(s), false, `openai: ${s}`);

  // anthropic-messages: o raciocínio dela volta, antes do texto; a assinatura do Gemini não existe aqui
  const a = from(anthropicBuildRequest, accAnthropic);
  assert.deepEqual(a.messages[1].content, [
    { type: 'thinking', thinking: 'vou consultar', signature: 'SIG-ANTHROPIC' },
    { type: 'redacted_thinking', data: 'RED-ANTHROPIC' },
    { type: 'text', text: 'Consultando.' },
    { type: 'tool_use', id: 'toolu_1', name: 'clima', input: { cidade: 'CG' } },
  ]);
  assert.deepEqual(a.messages[2].content, [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'timeout', is_error: true }]);
  assert.deepEqual(a.messages[3].content, [{ type: 'text', text: 'Tentando de novo.' }, { type: 'tool_use', id: 'gemini-tc-0', name: 'clima', input: { cidade: 'CG' } }]);
  assert.deepEqual(a.tool_choice, { type: 'auto' });
  assert.deepEqual(a.stop_sequences, ['FIM']);
  for (const s of ['SIG-GEMINI', 'providerData', 'thoughtSignature', 'isError']) assert.equal(JSON.stringify(a).includes(s), false, `anthropic: ${s}`);

  // google-generative-ai: a assinatura dele volta ao lado do functionCall; nada da Anthropic existe aqui
  const g = from(buildRequest, account);
  assert.deepEqual(g.contents[1], { role: 'model', parts: [{ text: 'Consultando.' }, { functionCall: { name: 'clima', args: { cidade: 'CG' } } }] });
  assert.deepEqual(g.contents[2].parts, [{ functionResponse: { name: 'clima', response: { error: 'timeout' } } }]);
  assert.deepEqual(g.contents[3], { role: 'model', parts: [{ text: 'Tentando de novo.' }, { functionCall: { name: 'clima', args: { cidade: 'CG' } }, thoughtSignature: 'SIG-GEMINI' }] });
  assert.deepEqual(g.toolConfig, { functionCallingConfig: { mode: 'AUTO' } });
  assert.deepEqual(g.generationConfig, { stopSequences: ['FIM'] });
  for (const s of ['SIG-ANTHROPIC', 'RED-ANTHROPIC', 'vou consultar', 'providerData', 'isError']) assert.equal(JSON.stringify(g).includes(s), false, `google: ${s}`);
});

test('toolChoice e stop explícitos vencem params', () => {
  const { body } = build({ messages: [{ role: 'user', content: 'oi' }], tools: [{ name: 't', parameters: { type: 'object', properties: { a: { type: 'string' } } } }], toolChoice: 'none', stop: ['A'], params: { toolConfig: { x: 1 }, generationConfig: { stopSequences: ['B'], temperature: 0.1 } } });
  assert.equal(body.toolConfig.functionCallingConfig.mode, 'NONE');
  assert.deepEqual(body.generationConfig, { stopSequences: ['A'], temperature: 0.1 });
});

test('maxTokens e temperature explícitos vencem params', () => {
  const { body } = build({ messages: [{ role: 'user', content: 'oi' }], maxTokens: 50, temperature: 0.7, params: { generationConfig: { maxOutputTokens: 1, temperature: 0.1 } } });
  assert.deepEqual([body.generationConfig.maxOutputTokens, body.generationConfig.temperature], [50, 0.7]);
});
