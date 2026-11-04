import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decision } from '../src/apis/openai-completions/decision.js';
import { resolveCompat } from '../src/compat.js';

/** @param {unknown} corpo */
const res = (corpo) => ({
  status: 200,
  headers: new Headers(),
  json: async () => corpo,
  bytes: async () => new Uint8Array(),
});

const account = (baseUrl) => ({ id: 'a', provider: 'p', api: 'openai-completions', baseUrl, apiKey: 'k' });
const model = { id: 'm-decision' };
const request = { state: { s: 1 }, questions: { q: { type: 'string' } } };

/** @param {string} baseUrl @param {string|null} decisionPath */
const ctx = (baseUrl, decisionPath) => {
  const acc = account(baseUrl);
  return { account: acc, model, compat: { ...resolveCompat(acc, model), decisionPath }, request };
};

test('decisionPath ../alpha/decisions resolve contra a base', () => {
  const { url } = decision.buildRequest({ ...ctx('https://openrouter.ai/api/v1', '../alpha/decisions'), apiKey: 'k' });
  assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
});

test('decisionPath systemone entra depois da versão da base', () => {
  const { url } = decision.buildRequest({ ...ctx('https://api.typesafe.ai/v1', 'systemone'), apiKey: 'k' });
  assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
});

test('sem decisionPath recusa com unsupported', () => {
  assert.throws(
    () => decision.buildRequest({ ...ctx('https://x/v1', null), apiKey: 'k' }),
    (err) => err.name === 'ProviderError' && err.type === 'unsupported',
  );
});

test('questions vazio e state em lista recusam com invalid_request', () => {
  const c = ctx('https://x/v1', 'decisions');
  assert.throws(
    () => decision.buildRequest({ ...c, apiKey: 'k', request: { state: {}, questions: {} } }),
    (err) => err.name === 'ProviderError' && err.type === 'invalid_request' && err.retryOther === false,
  );
  assert.throws(
    () => decision.buildRequest({ ...c, apiKey: 'k', request: { state: [], questions: { q: 1 } } }),
    (err) => err.name === 'ProviderError' && err.type === 'invalid_request' && err.retryOther === false,
  );
});

test('answers e usage com custo informado', async () => {
  const corpo = { answers: { a: 1 }, usage: { input_tokens: 3, output_tokens: 4, cost: 0.2 } };
  const { result, usage, reportedCostUsd } = await decision.parseResponse(res(corpo), ctx('https://x/v1', 'decisions'));
  assert.deepEqual(result.answers, { a: 1 });
  assert.equal(usage.input, 3);
  assert.equal(usage.output, 4);
  assert.equal(reportedCostUsd, 0.2);
});

test('answers vazio recusa com upstream', async () => {
  await assert.rejects(
    () => decision.parseResponse(res({ answers: {} }), ctx('https://x/v1', 'decisions')),
    (err) => err.name === 'ProviderError' && err.type === 'upstream',
  );
});

test('sem cost (TypeSafe): reportedCostUsd null e sem erro', async () => {
  const corpo = { answers: { a: 1 }, usage: { input_tokens: 3, output_tokens: 4 } };
  const { reportedCostUsd } = await decision.parseResponse(res(corpo), ctx('https://api.typesafe.ai/v1', 'systemone'));
  assert.equal(reportedCostUsd, null);
});
