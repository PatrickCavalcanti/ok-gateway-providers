// Operações pela porta pública: cliente + fio openai-completions + custo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, getApi } from '../src/index.js';

const account = (compat = {}) => ({ id: 'a', provider: 'p', api: 'openai-completions', baseUrl: 'https://x/v1', apiKey: 'k', compat });
const model = (operation, cost) => ({ id: 'm', operations: [operation], input: ['text'], output: ['text'], ...(cost ? { cost } : {}) });

function fetchOf(body, init = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), { status: 200, ...init });
  };
  fn.calls = calls;
  return fn;
}

test('o fio declara as cinco operações', () => {
  assert.deepEqual(Object.keys(getApi('openai-completions').operations).sort(), ['decision', 'embeddings', 'image-generation', 'speech', 'transcription']);
});

test('embed: vetores, uso e custo pela tabela', async () => {
  const fetch = fetchOf({ data: [{ index: 0, embedding: [0.1] }], usage: { prompt_tokens: 1000 } });
  const r = await createClient({ account: account(), model: model('embeddings', { input: 1, output: 0 }), fetch }).embed({ texts: ['oi'] });
  assert.deepEqual(r.vectors, [[0.1]]);
  assert.equal(r.usage.input, 1000);
  assert.deepEqual(r.cost, { usd: 0.001, source: 'table' });
  assert.equal(fetch.calls[0].url, 'https://x/v1/embeddings');
});

test('transcribe: multipart sem content-type e custo por segundo', async () => {
  const fetch = fetchOf({ text: 'olá', duration: 20 });
  const r = await createClient({
    account: account({ sttResponseFormat: 'verbose_json' }),
    model: model('transcription', { input: 0, output: 0, audioPerSecond: 0.01, minBilledSeconds: 10 }),
    fetch,
  }).transcribe({ audio: new Uint8Array([1, 2]), mime: 'audio/mpeg' });
  assert.equal(r.text, 'olá');
  assert.deepEqual(r.cost, { usd: 0.2, source: 'table' });
  const { opts } = fetch.calls[0];
  assert.ok(opts.body instanceof FormData);
  assert.equal(opts.headers['content-type'], undefined);
  assert.equal(opts.headers.authorization, 'Bearer k');
});

test('speak: bytes, content-type do provedor e custo por caractere', async () => {
  const fetch = fetchOf(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/pcm;rate=24000' } });
  const r = await createClient({ account: account(), model: model('speech', { input: 30, output: 0 }), fetch }).speak({ text: 'abcd' });
  assert.deepEqual([...r.audio], [1, 2, 3]);
  assert.equal(r.contentType, 'audio/pcm;rate=24000');
  assert.deepEqual(r.cost, { usd: 0.00012, source: 'table' });
});

test('generateImage: custo informado pelo provedor; sem custo, usd null e sem erro', async () => {
  const comCusto = fetchOf({ data: [{ b64_json: 'QUJD' }], usage: { cost: 0.03 } });
  const a = await createClient({ account: account({ imagePath: '/images', imageResponseFormat: null }), model: model('image-generation'), fetch: comCusto }).generateImage({ prompt: 'x' });
  assert.deepEqual(a.images, [{ base64: 'QUJD', mediaType: 'image/png' }]);
  assert.deepEqual(a.cost, { usd: 0.03, source: 'provider' });
  assert.equal(comCusto.calls[0].url, 'https://x/v1/images');

  const semCusto = fetchOf({ data: [{ b64_json: 'QUJD' }] });
  const b = await createClient({ account: account(), model: model('image-generation'), fetch: semCusto }).generateImage({ prompt: 'x' });
  assert.deepEqual(b.cost, { usd: null, source: 'none' });
});

test('decide: caminho pelo compat; sem decisionPath é unsupported antes do fetch', async () => {
  const fetch = fetchOf({ answers: { a: true }, usage: { input_tokens: 1, output_tokens: 1, cost: 0.001 } });
  const r = await createClient({
    account: { ...account({ decisionPath: '../alpha/decisions' }), baseUrl: 'https://openrouter.ai/api/v1' },
    model: model('decision'),
    fetch,
  }).decide({ state: { s: 1 }, questions: { a: {} } });
  assert.deepEqual(r.answers, { a: true });
  assert.equal(fetch.calls[0].url, 'https://openrouter.ai/api/alpha/decisions');

  const nunca = fetchOf({});
  await assert.rejects(
    createClient({ account: account(), model: model('decision'), fetch: nunca }).decide({ state: {}, questions: { a: {} } }),
    (e) => e.type === 'unsupported',
  );
  assert.equal(nunca.calls.length, 0);
});

test('embed recusa resposta com vetor vazio, não numérico ou index repetido', async () => {
  for (const data of [
    [{ index: 0, embedding: [] }],
    [{ index: 0, embedding: ['x'] }],
    [{ index: 0, embedding: [1] }, { index: 0, embedding: [2] }],
  ]) {
    const texts = data.map(() => 't');
    await assert.rejects(
      createClient({ account: account(), model: model('embeddings'), fetch: fetchOf({ data }) }).embed({ texts }),
      (e) => e.type === 'upstream',
    );
  }
});
