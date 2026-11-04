// Correções da revisão do conjunto da T1.2: cancelamento no corpo de erro, signal inválido, corpo não serializável,
// anthropic-version da conta, imagem com cache, catálogo do Gateway, finishReason do Gemini, base64 canônico e a
// tabela de métodos do cliente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/client.js';
import { getApi } from '../src/client.js';
import { ProviderError } from '../src/errors.js';
import { resolveCompat } from '../src/compat.js';
import { METHODS_BY_OPERATION } from '../src/vocabulary.js';
import { parseOpenRouterModels } from '../src/catalog/openrouter.js';
import { parseStream as parseGemini } from '../src/apis/google-generative-ai.js';
import { imageGeneration } from '../src/apis/openai-completions/image.js';
import '../src/index.js';

const hi = [{ role: 'user', content: 'oi' }];
const account = { id: 'x', provider: 'p', api: 'openai-completions', baseUrl: 'https://x/v1', apiKey: 'k', compat: { decisionPath: 'd' } };
const model = { id: 'm', operations: ['chat', 'decision', 'embeddings'], input: ['text'], output: ['text'] };

/** Resposta 500 cujo corpo só termina quando o fetch é abortado. */
function hangingError(ac) {
  return async (_url, init) => new Response(new ReadableStream({
    start(ctrl) { init.signal.addEventListener('abort', () => ctrl.error(new Error('abortado'))); setTimeout(() => ac.abort(), 10); },
  }), { status: 500 });
}

test('M1: cancelar durante a leitura do corpo de erro dá aborted, no chat e nas operações', async () => {
  const ac = new AbortController();
  const chat = createClient({ account, model, fetch: hangingError(ac) }).chat({ messages: hi, signal: ac.signal });
  const e = await chat.result.then(() => null, (err) => err);
  assert.deepEqual([e.type, e.retryOther], ['aborted', false]);
  const ac2 = new AbortController();
  const op = await createClient({ account, model, fetch: hangingError(ac2) }).embed({ texts: ['a'], signal: ac2.signal }).then(() => null, (err) => err);
  assert.deepEqual([op.type, op.retryOther], ['aborted', false]);
});

test('M2: signal que não é AbortSignal dá invalid_request, não TypeError cru', async () => {
  const fetch = async () => new Response('{}');
  const op = await createClient({ account, model, fetch }).embed({ texts: ['a'], signal: /** @type {any} */ ({}) }).then(() => null, (err) => err);
  assert.ok(op instanceof ProviderError, String(op));
  assert.deepEqual([op.type, op.retryOther], ['invalid_request', false]);
  let run;
  assert.doesNotThrow(() => { run = createClient({ account, model, fetch }).chat({ messages: hi, signal: /** @type {any} */ ({}) }); });
  const e = await run.result.then(() => null, (err) => err);
  assert.deepEqual([e.type, e.retryOther], ['invalid_request', false]);
});

test('M3: corpo que não serializa é invalid_request sem outro alvo, nos dois caminhos', async () => {
  const circ = {}; circ.self = circ;
  const fetch = async () => new Response('{}');
  const op = await createClient({ account, model, fetch }).decide({ state: circ, questions: { q: {} } }).then(() => null, (err) => err);
  assert.deepEqual([op.type, op.retryOther], ['invalid_request', false]);
  assert.match(op.message, /serializa/);
  const run = createClient({ account, model, fetch }).chat({ messages: hi, params: { extra: circ } });
  const e = await run.result.then(() => null, (err) => err);
  assert.deepEqual([e.type, e.retryOther], ['invalid_request', false]);
});

test('M4: anthropic-version da conta ou do compat vence o padrão, sem diferença de caixa', async () => {
  const seen = [];
  const fetch = async (_url, init) => { seen.push(init.headers['anthropic-version']); return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n'); };
  const base = { id: 'a', provider: 'anthropic', api: 'anthropic-messages', baseUrl: 'https://x/v1', apiKey: 'k' };
  const m = { id: 'c', operations: ['chat'], input: ['text'], output: ['text'] };
  for (const acc of [base, { ...base, headers: { 'Anthropic-Version': '2099-01-01' } }, { ...base, compat: { headers: { 'ANTHROPIC-VERSION': '2098-01-01' } } }]) {
    await createClient({ account: acc, model: m, fetch }).chat({ messages: hi }).result;
  }
  assert.deepEqual(seen, ['2023-06-01', '2099-01-01', '2098-01-01']);
});

test('M5: imagem com cache leva cache_control no bloco, e no tool_result a marca sobe para o resultado', () => {
  const acc = { id: 'a', provider: 'anthropic', api: 'anthropic-messages', baseUrl: 'https://x/v1' };
  const m = { id: 'c', operations: ['chat'], input: ['text', 'image'], output: ['text'] };
  const build = (messages) => getApi('anthropic-messages').buildRequest({ account: acc, model: m, compat: resolveCompat(acc, m), apiKey: 'k', request: { messages } }).body;
  const user = build([{ role: 'user', content: [{ type: 'image', data: 'QUJD', mime: 'image/png', cache: { ttl: '1h' } }] }]);
  assert.deepEqual(user.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' }, cache_control: { type: 'ephemeral', ttl: '1h' } });
  const plain = build([{ role: 'user', content: [{ type: 'image', data: 'QUJD', mime: 'image/png' }] }]);
  assert.equal('cache_control' in plain.messages[0].content[0], false);
  const tool = build([
    { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'f', arguments: '{}' }] },
    { role: 'tool', toolCallId: 't1', content: [{ type: 'image', data: 'QUJD', mime: 'image/png', cache: { ttl: '5m' } }] },
  ]);
  const result = tool.messages[1].content[0];
  assert.deepEqual(result.cache_control, { type: 'ephemeral' });
  assert.equal('cache_control' in result.content[0], false);
});

test('M6: gateway.operation do /v1/models define as operações; sem ele vale a regra da forma', () => {
  const models = parseOpenRouterModels({ data: [
    { id: 'gw/stt', architecture: { input_modalities: ['audio'], output_modalities: ['text'] }, gateway: { kind: 'profile', operation: 'transcription' } },
    { id: 'gw/dec', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, gateway: { kind: 'profile', operation: 'decision' } },
    { id: 'gw/img', architecture: { input_modalities: ['text'], output_modalities: ['image'] }, gateway: { kind: 'profile', operation: 'image-generation' } },
    { id: 'gw/prod', gateway: { kind: 'product' } },
    { id: 'gw/estranha', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, gateway: { kind: 'profile', operation: 'inventada' } },
  ] });
  assert.deepEqual(models.map((x) => [x.id, x.operations]), [
    ['gw/stt', ['transcription']], ['gw/dec', ['decision']], ['gw/img', ['image-generation']], ['gw/prod', ['chat']], ['gw/estranha', ['chat']],
  ]);
});

/** @param {object[]} chunks */
async function gemini(chunks) {
  const events = (async function* () { for (const c of chunks) yield { data: JSON.stringify(c) }; })();
  const gen = parseGemini(events, { account: { provider: 'g' }, model: { id: 'm' } });
  const out = [];
  try {
    while (true) {
      const s = await gen.next();
      if (s.done) return { out, finish: s.value.finishReason, error: null };
      out.push(s.value);
    }
  } catch (error) { return { out, finish: null, error }; }
}

test('M8: PROHIBITED_CONTENT, BLOCKLIST e SPII são content_filter; MALFORMED_FUNCTION_CALL é upstream', async () => {
  for (const reason of ['PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']) {
    assert.equal((await gemini([{ candidates: [{ finishReason: reason }] }])).finish, 'content_filter', reason);
  }
  const bad = await gemini([{ candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] }]);
  assert.equal(bad.error?.type, 'upstream');
  assert.match(bad.error.message, /MALFORMED_FUNCTION_CALL/);
  assert.equal((await gemini([{ candidates: [{ finishReason: 'OTHER' }] }])).finish, 'other');
});

test('M10: todo método de METHODS_BY_OPERATION existe no cliente, e só eles', () => {
  const client = createClient({ account, model });
  const expected = Object.values(METHODS_BY_OPERATION).flat();
  for (const method of expected) assert.equal(typeof client[method], 'function', method);
  assert.deepEqual(Object.keys(client).filter((k) => typeof client[k] === 'function').sort(), [...expected].sort());
});

test('M12: base64 da imagem tem de ser canônico; media_type vazio cai no padrão', async () => {
  const acc = { id: 'a', provider: 'p', api: 'openai-completions', baseUrl: 'https://x/v1' };
  const mdl = { id: 'm' };
  const parse = (item) => imageGeneration.parseResponse({ status: 200, headers: new Headers(), json: async () => ({ data: [item] }), bytes: async () => new Uint8Array() }, { account: acc, model: mdl, compat: resolveCompat(acc, mdl), request: {} });
  // 'QR==' decodifica para "A", mas o bit sobrando não é zero: o canônico seria 'QQ=='
  await assert.rejects(parse({ b64_json: 'QR==' }), (e) => e.type === 'upstream');
  await assert.rejects(parse({ b64_json: '' }), (e) => e.type === 'upstream');
  assert.deepEqual((await parse({ b64_json: 'QQ==' })).result.images, [{ base64: 'QQ==', mediaType: 'image/png' }]);
  assert.equal((await parse({ b64_json: 'QUJD', media_type: '' })).result.images[0].mediaType, 'image/png');
  assert.equal((await parse({ b64_json: 'QUJD', media_type: '   ' })).result.images[0].mediaType, 'image/png');
  assert.equal((await parse({ b64_json: 'QUJD', media_type: 'image/webp' })).result.images[0].mediaType, 'image/webp');
});
