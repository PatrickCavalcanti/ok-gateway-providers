// Diagnóstico (I3): o erro e o sucesso carregam o que o Gateway expõe — code, errorType, providerCode,
// providerName e o id da geração (header x-generation-id). Corpo e headers no formato que os fios leem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/client.js';
import { diagnosticFields, errorFromStatus, ProviderError } from '../src/errors.js';
import '../src/index.js';

/** Corpo de erro do OpenRouter (HTTP 429 de um provedor por trás). */
const OR_ERROR = JSON.stringify({
  error: {
    message: 'Provider returned error',
    code: 429,
    metadata: { raw: '{"error":"quota"}', provider_name: 'Google AI Studio', error_type: 'rate_limit_exceeded', provider_code: 'RESOURCE_EXHAUSTED' },
  },
});

const hi = [{ role: 'user', content: 'oi' }];
const completionsAccount = { id: 'or', provider: 'openrouter', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' };
const chatModel = { id: 'm', operations: ['chat', 'embeddings', 'speech'], input: ['text'], output: ['text'] };

/** @param {string} body @param {ResponseInit} [init] */
const respond = (body, init = {}) => async () => new Response(body, init);

test('errorFromStatus lê code, errorType, providerCode e providerName do corpo do OpenRouter', () => {
  const e = errorFromStatus(429, { provider: 'openrouter', model: 'm', body: OR_ERROR });
  assert.equal(e.type, 'rate_limit');
  assert.deepEqual([e.code, e.errorType, e.providerCode, e.providerName], [429, 'rate_limit_exceeded', 'RESOURCE_EXHAUSTED', 'Google AI Studio']);
});

test('errorFromStatus: formatos da Anthropic, da OpenAI, do Gemini e do evento error da Responses', () => {
  const anthropic = errorFromStatus(529, { body: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' });
  assert.deepEqual([anthropic.code, anthropic.errorType], [undefined, 'overloaded_error']);
  const openai = errorFromStatus(400, { body: '{"error":{"message":"x","type":"invalid_request_error","code":"context_length_exceeded"}}' });
  assert.deepEqual([openai.code, openai.errorType], ['context_length_exceeded', 'invalid_request_error']);
  const gemini = errorFromStatus(503, { body: '{"error":{"code":503,"message":"x","status":"UNAVAILABLE"}}' });
  assert.deepEqual([gemini.code, gemini.errorType], [503, 'UNAVAILABLE']);
  const responses = errorFromStatus(500, { body: { type: 'error', code: 'server_error', message: 'x' } });
  assert.deepEqual([responses.code, responses.errorType], ['server_error', undefined]);
  const failed = errorFromStatus(429, { body: { type: 'response.failed', response: { error: { code: 'rate_limit_exceeded', message: 'x' } } } });
  assert.equal(failed.code, 'rate_limit_exceeded');
});

test('corpo que não é JSON, vazio ou sem error: campos ausentes, sem exceção', () => {
  for (const body of ['<html>502</html>', '', undefined, '[]', '{"ok":true}']) {
    const e = errorFromStatus(502, { body });
    assert.deepEqual([e.code, e.errorType, e.providerCode, e.providerName, e.generationId], [undefined, undefined, undefined, undefined, undefined], String(body));
  }
});

test('chat: HTTP 429 com corpo do OpenRouter e x-generation-id preenche o erro', async () => {
  const run = createClient({ account: completionsAccount, model: chatModel, fetch: respond(OR_ERROR, { status: 429, headers: { 'x-generation-id': 'gen-err-1' } }) }).chat({ messages: hi });
  const e = await run.result.then(() => null, (err) => err);
  assert.ok(e instanceof ProviderError);
  assert.equal(e.status, 429);
  assert.deepEqual([e.code, e.errorType, e.providerCode, e.providerName, e.generationId], [429, 'rate_limit_exceeded', 'RESOURCE_EXHAUSTED', 'Google AI Studio', 'gen-err-1']);
});

test('chat: erro no meio do stream (200) leva o código do chunk e o id da geração', async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"oi"}}]}\n\ndata: {"error":{"code":"server_error","message":"caiu","metadata":{"provider_name":"Novita"}},"choices":[{"finish_reason":"error"}]}\n\n';
  const run = createClient({ account: completionsAccount, model: chatModel, fetch: respond(sse, { headers: { 'x-generation-id': 'gen-mid-1' } }) }).chat({ messages: hi });
  const e = await run.result.then(() => null, (err) => err);
  assert.equal(e.emitted, true);
  assert.deepEqual([e.code, e.providerName, e.generationId], ['server_error', 'Novita', 'gen-mid-1']);
});

test('chat: erro do stream da Anthropic leva errorType', async () => {
  const account = { id: 'a', provider: 'anthropic', api: 'anthropic-messages', baseUrl: 'https://x/v1', apiKey: 'k' };
  const sse = 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
  const run = createClient({ account, model: chatModel, fetch: respond(sse, { headers: { 'x-generation-id': 'g' } }) }).chat({ messages: hi });
  const e = await run.result.then(() => null, (err) => err);
  assert.deepEqual([e.type, e.errorType, e.generationId], ['upstream', 'overloaded_error', 'g']);
});

test('chat: sucesso devolve generationId no result e no evento end; sem header, o campo some', async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"oi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
  const run = createClient({ account: completionsAccount, model: chatModel, fetch: respond(sse, { headers: { 'x-generation-id': 'gen-ok-1' } }) }).chat({ messages: hi });
  const events = []; for await (const ev of run) events.push(ev);
  const result = await run.result;
  assert.equal(result.generationId, 'gen-ok-1');
  assert.equal(events.at(-1).generationId, 'gen-ok-1');
  const bare = createClient({ account: completionsAccount, model: chatModel, fetch: respond(sse) }).chat({ messages: hi });
  assert.equal('generationId' in (await bare.result), false);
});

test('operação de chamada única: id da geração no resultado e no erro', async () => {
  const ok = JSON.stringify({ data: [{ index: 0, embedding: [1] }], usage: { prompt_tokens: 1 } });
  const r = await createClient({ account: completionsAccount, model: chatModel, fetch: respond(ok, { headers: { 'x-generation-id': 'gen-emb' } }) }).embed({ texts: ['a'] });
  assert.equal(r.generationId, 'gen-emb');
  const e = await createClient({ account: completionsAccount, model: chatModel, fetch: respond(OR_ERROR, { status: 429, headers: { 'x-generation-id': 'gen-emb-err' } }) }).embed({ texts: ['a'] }).then(() => null, (err) => err);
  assert.deepEqual([e.code, e.errorType, e.generationId], [429, 'rate_limit_exceeded', 'gen-emb-err']);
  // resposta 200 inválida (upstream da lib): também leva o id
  const bad = await createClient({ account: completionsAccount, model: chatModel, fetch: respond('{"data":[]}', { headers: { 'x-generation-id': 'gen-bad' } }) }).embed({ texts: ['a'] }).then(() => null, (err) => err);
  assert.deepEqual([bad.type, bad.generationId], ['upstream', 'gen-bad']);
});

test('fala: o id da geração vai no resultado, e continua em usage.raw (spec §3)', async () => {
  const r = await createClient({ account: completionsAccount, model: chatModel, fetch: respond(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-tts' } }) }).speak({ text: 'oi' });
  assert.equal(r.generationId, 'gen-tts');
  assert.deepEqual(r.usage.raw, { generationId: 'gen-tts' });
});

test('campos de diagnóstico têm teto de 200 caracteres', () => {
  const big = 'x'.repeat(5000);
  const d = diagnosticFields({ error: { code: big, type: big, metadata: { provider_name: big } } });
  assert.equal(d.code.length, 200);
  assert.equal(d.providerName.length, 200);
});
