import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError, errorFromStatus, unsupported, truncateBody, typeFromStatus, extractMessage, MAX_BODY_BYTES } from '../src/errors.js';

test('status → tipo (spec §8)', () => {
  assert.equal(typeFromStatus(401), 'auth');
  assert.equal(typeFromStatus(403), 'auth');
  assert.equal(typeFromStatus(429), 'rate_limit');
  for (const s of [400, 404, 422, 409]) assert.equal(typeFromStatus(s), 'invalid_request');
  for (const s of [500, 502, 503, 529]) assert.equal(typeFromStatus(s), 'upstream');
});

test('errorFromStatus monta erro com contexto e mensagem do corpo', () => {
  const e = errorFromStatus(429, { provider: 'openrouter', model: 'x/y', body: '{"error":{"message":"devagar"}}' });
  assert.ok(e instanceof ProviderError);
  assert.equal(e.type, 'rate_limit');
  assert.equal(e.retryOther, true);
  assert.equal(e.emitted, false);
  assert.equal(e.status, 429);
  assert.match(e.message, /openrouter\/x\/y: HTTP 429 — devagar/);
});

test('só aborted não deixa tentar outro', () => {
  assert.equal(new ProviderError({ type: 'aborted', message: 'x' }).retryOther, false);
  for (const type of /** @type {const} */ (['auth', 'rate_limit', 'invalid_request', 'upstream', 'timeout', 'unsupported'])) {
    assert.equal(new ProviderError({ type, message: 'x' }).retryOther, true, type);
  }
  assert.equal(unsupported('sem vídeo', { provider: 'p', model: 'm' }).type, 'unsupported');
});

test('corpo cortado em 2 KB, sem caractere partido', () => {
  const big = 'é'.repeat(5000);
  const cut = /** @type {string} */ (truncateBody(big));
  assert.ok(Buffer.byteLength(cut, 'utf8') <= MAX_BODY_BYTES);
  assert.ok(!cut.includes('�'));
  assert.equal(truncateBody(undefined), undefined);
  assert.equal(truncateBody({ a: 1 }), '{"a":1}');
  assert.equal(new ProviderError({ type: 'upstream', message: 'x', body: 'a'.repeat(9000) }).body?.length, MAX_BODY_BYTES);
});

test('extractMessage tolera formatos', () => {
  assert.equal(extractMessage({ error: { message: 'm1' } }), 'm1');
  assert.equal(extractMessage({ message: 'm2' }), 'm2');
  assert.equal(extractMessage({ error: 'm3' }), 'm3');
  assert.equal(extractMessage('texto cru'), 'texto cru');
  assert.equal(extractMessage(''), undefined);
  assert.equal(extractMessage(null), undefined);
});
