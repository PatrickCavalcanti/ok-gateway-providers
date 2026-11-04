import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageGeneration } from '../src/apis/openai-completions/image.js';
import { resolveCompat } from '../src/compat.js';

const account = { id: 'a', provider: 'p', api: 'openai-completions', baseUrl: 'https://x/v1', apiKey: 'k' };
const model = { id: 'm-image' };

/** @param {unknown} corpo */
const res = (corpo) => ({
  status: 200,
  headers: new Headers(),
  json: async () => corpo,
  bytes: async () => new Uint8Array(),
});

const ctx = () => ({ account, model, compat: resolveCompat(account, model), request: {} });

test('padrão: URL de images/generations e response_format b64_json', () => {
  const { url, body } = imageGeneration.buildRequest({ ...ctx(), apiKey: 'k', request: { prompt: 'gato' } });
  assert.equal(url, 'https://x/v1/images/generations');
  assert.equal(body.response_format, 'b64_json');
  assert.equal(body.model, model.id);
  assert.equal(body.prompt, 'gato');
});

test('compat imagePath /images e imageResponseFormat null: URL de /images e sem response_format', () => {
  const compat = { ...resolveCompat(account, model), imagePath: '/images', imageResponseFormat: null };
  const { url, body } = imageGeneration.buildRequest({ account, model, compat, apiKey: 'k', request: { prompt: 'gato' } });
  assert.equal(url, 'https://x/v1/images');
  assert.equal('response_format' in body, false);
});

test('imagem com media_type e custo informado', async () => {
  const corpo = { data: [{ b64_json: 'QUJD', media_type: 'image/webp' }], usage: { prompt_tokens: 1, completion_tokens: 2, cost: 0.1 } };
  const { result, usage, reportedCostUsd } = await imageGeneration.parseResponse(res(corpo), { ...ctx(), request: {} });
  assert.deepEqual(result.images, [{ base64: 'QUJD', mediaType: 'image/webp' }]);
  assert.equal(usage.input, 1);
  assert.equal(usage.output, 2);
  assert.equal(reportedCostUsd, 0.1);
});

test('imagem sem media_type vira image/png', async () => {
  const corpo = { data: [{ b64_json: 'QUJD' }] };
  const { result } = await imageGeneration.parseResponse(res(corpo), { ...ctx(), request: {} });
  assert.equal(result.images[0].mediaType, 'image/png');
});

test('data: [] recusa com upstream', async () => {
  await assert.rejects(
    () => imageGeneration.parseResponse(res({ data: [] }), { ...ctx(), request: {} }),
    (err) => err.name === 'ProviderError' && err.type === 'upstream',
  );
});

test('params.n: 2 com uma imagem recusa com upstream', async () => {
  const corpo = { data: [{ b64_json: 'QUJD' }] };
  await assert.rejects(
    () => imageGeneration.parseResponse(res(corpo), { ...ctx(), request: { params: { n: 2 } } }),
    (err) => err.name === 'ProviderError' && err.type === 'upstream',
  );
});

test('base64 inválido recusa com upstream', async () => {
  const corpo = { data: [{ b64_json: 'a b' }] };
  await assert.rejects(
    () => imageGeneration.parseResponse(res(corpo), { ...ctx(), request: {} }),
    (err) => err.name === 'ProviderError' && err.type === 'upstream',
  );
});

test('sem usage.cost: reportedCostUsd null e sem erro', async () => {
  const corpo = { data: [{ b64_json: 'QUJD' }], usage: { prompt_tokens: 1 } };
  const { reportedCostUsd } = await imageGeneration.parseResponse(res(corpo), { ...ctx(), request: {} });
  assert.equal(reportedCostUsd, null);
});

test('prompt vazio recusa com invalid_request sem tentar outro provedor', () => {
  assert.throws(
    () => imageGeneration.buildRequest({ ...ctx(), apiKey: 'k', request: { prompt: '' } }),
    (err) => err.name === 'ProviderError' && err.type === 'invalid_request' && err.retryOther === false,
  );
});
