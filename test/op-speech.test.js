import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCompat } from '../src/compat.js';
import { speech } from '../src/apis/openai-completions/speech.js';

const account = { id: 'a', provider: 'p', api: 'openai-completions', baseUrl: 'https://x/v1', apiKey: 'k' };

/** @param {Record<string, unknown>} [extra] */
const mkModel = (extra = {}) => ({ id: 'm', ...extra });

/** @param {Record<string, unknown>} model @param {Record<string, unknown>} request */
const ctx = (model, request) => ({ account, model, compat: resolveCompat(account, model), request });

/** @param {Record<string, unknown>} model @param {Record<string, unknown>} request */
const build = (model, request) => speech.buildRequest({ ...ctx(model, request), apiKey: 'k' });

/**
 * @param {{ headers?: Record<string, string>, bytes?: () => Promise<Uint8Array> }} [opts]
 */
const mkRes = ({ headers = {}, bytes = async () => new Uint8Array([1, 2, 3]) } = {}) => ({
  status: 200,
  headers: new Headers(headers),
  json: async () => ({}),
  bytes,
});

test('sem voz nem formato, compat nulo: corpo só com model e input', () => {
  const { body, url, headers } = build(mkModel(), { text: 'oi' });
  assert.deepEqual(body, { model: 'm', input: 'oi' });
  assert.deepEqual(Object.keys(body), ['model', 'input']);
  assert.equal(url, 'https://x/v1/audio/speech');
  assert.equal(headers.Authorization, 'Bearer k');
});

test('compat traz voz e formato padrão; voice do pedido vence', () => {
  const model = mkModel({ compat: { ttsDefaultVoice: 'onyx', ttsDefaultFormat: 'mp3' } });
  assert.equal(build(model, { text: 'oi' }).body.voice, 'onyx');
  assert.equal(build(model, { text: 'oi' }).body.response_format, 'mp3');
  assert.equal(build(model, { text: 'oi', voice: 'nova' }).body.voice, 'nova');
});

test('params: input é protegido e o resto passa', () => {
  const { body } = build(mkModel(), { text: 'oi', params: { input: 'x', sample_rate: 24000 } });
  assert.equal(body.input, 'oi');
  assert.equal(body.sample_rate, 24000);
  assert.equal(body.model, 'm');
});

test('instructions e speed só vão quando vierem', () => {
  const sem = build(mkModel(), { text: 'oi' }).body;
  assert.equal('instructions' in sem, false);
  assert.equal('speed' in sem, false);
  const com = build(mkModel(), { text: 'oi', instructions: 'sussurre', speed: 1 }).body;
  assert.equal(com.instructions, 'sussurre');
  assert.equal(com.speed, 1);
});

test('content-type de áudio passa com o parâmetro', async () => {
  const { result } = await speech.parseResponse(
    mkRes({ headers: { 'content-type': 'audio/pcm;rate=24000' } }),
    ctx(mkModel({ compat: { ttsDefaultFormat: 'pcm' } }), { text: 'oi' }),
  );
  assert.equal(result.contentType, 'audio/pcm;rate=24000');
});

test('content-type não-áudio cai no mapa pelo formato', async () => {
  const { result } = await speech.parseResponse(
    mkRes({ headers: { 'content-type': 'application/octet-stream' } }),
    ctx(mkModel({ compat: { ttsDefaultFormat: 'mp3' } }), { text: 'oi' }),
  );
  assert.equal(result.contentType, 'audio/mpeg');
});

test('corpo vazio é erro upstream', async () => {
  await assert.rejects(
    () => speech.parseResponse(mkRes({ bytes: async () => new Uint8Array() }), ctx(mkModel(), { text: 'oi' })),
    (err) => {
      assert.equal(err.name, 'ProviderError');
      assert.equal(err.type, 'upstream');
      return true;
    },
  );
});

test('usage.input é o número de caracteres do texto', async () => {
  const { usage } = await speech.parseResponse(mkRes(), ctx(mkModel(), { text: 'abc' }));
  assert.equal(usage.input, 3);
  assert.equal(usage.missing, undefined);
});

test('x-generation-id vira usage.raw.generationId', async () => {
  const { usage } = await speech.parseResponse(
    mkRes({ headers: { 'x-generation-id': 'g1' } }),
    ctx(mkModel(), { text: 'oi' }),
  );
  assert.deepEqual(usage.raw, { generationId: 'g1' });
});
