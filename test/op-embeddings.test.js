import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embeddings } from '../src/apis/openai-completions/embeddings.js';

const account = { id: 'a', provider: 'p', api: 'openai-completions', baseUrl: 'https://x/v1', apiKey: 'k' };
const model = { id: 'm-embed' };
const compat = {};

/** @param {unknown} corpo */
const res = (corpo) => ({
  status: 200,
  headers: new Headers(),
  json: async () => corpo,
  bytes: async () => new Uint8Array(),
});

test('pedido com dimensions: 768 leva o campo; sem ela, o campo não existe', () => {
  const comDimensions = embeddings.buildRequest({ account, model, compat, apiKey: 'k', request: { texts: ['a'], dimensions: 768 } });
  assert.equal(comDimensions.body.dimensions, 768);

  const semDimensions = embeddings.buildRequest({ account, model, compat, apiKey: 'k', request: { texts: ['a'] } });
  assert.equal('dimensions' in semDimensions.body, false);
});

test('params: model é protegido, o resto passa', () => {
  const { body } = embeddings.buildRequest({ account, model, compat, apiKey: 'k', request: { texts: ['a'], params: { model: 'z', foo: 1 } } });
  assert.equal(body.model, model.id);
  assert.equal(body.foo, 1);
  assert.equal(body.input.length, 1);
});

test('texts: [] recusa com invalid_request sem tentar outro provedor', () => {
  assert.throws(
    () => embeddings.buildRequest({ account, model, compat, apiKey: 'k', request: { texts: [] } }),
    (err) => err.name === 'ProviderError' && err.type === 'invalid_request' && err.retryOther === false,
  );
});

test('data fora de ordem sai em ordem de index', async () => {
  const corpo = { data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }], usage: { prompt_tokens: 3 } };
  const { result } = await embeddings.parseResponse(res(corpo), { account, model, compat, request: { texts: ['a', 'b'] } });
  assert.deepEqual(result.vectors, [[1], [2]]);
});

test('um vetor para dois textos é upstream', async () => {
  const corpo = { data: [{ index: 0, embedding: [1] }], usage: { prompt_tokens: 3 } };
  await assert.rejects(
    () => embeddings.parseResponse(res(corpo), { account, model, compat, request: { texts: ['a', 'b'] } }),
    (err) => err.name === 'ProviderError' && err.type === 'upstream',
  );
});

test('tokens em cache saem do input', async () => {
  const corpo = { data: [{ index: 0, embedding: [1] }], usage: { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 4 } } };
  const { usage } = await embeddings.parseResponse(res(corpo), { account, model, compat, request: { texts: ['a'] } });
  assert.equal(usage.input, 6);
  assert.equal(usage.cacheRead, 4);
  assert.equal(usage.missing, undefined);
});

test('sem usage o uso é missing', async () => {
  const corpo = { data: [{ index: 0, embedding: [1] }] };
  const { usage } = await embeddings.parseResponse(res(corpo), { account, model, compat, request: { texts: ['a'] } });
  assert.equal(usage.missing, true);
});

test('usage.cost vira reportedCostUsd', async () => {
  const corpo = { data: [{ index: 0, embedding: [1] }], usage: { prompt_tokens: 2, cost: 0.01 } };
  const { reportedCostUsd } = await embeddings.parseResponse(res(corpo), { account, model, compat, request: { texts: ['a'] } });
  assert.equal(reportedCostUsd, 0.01);
});
