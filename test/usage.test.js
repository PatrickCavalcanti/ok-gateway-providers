import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUsage, reportedCost } from '../src/usage.js';

test('uso com número não é missing', () => {
  assert.equal(makeUsage({ input: 3 }).missing, undefined);
  assert.equal(makeUsage({ audioSeconds: 2 }).missing, undefined);
});
test('uso sem número é missing, nunca zero calado', () => {
  assert.equal(makeUsage().missing, true);
});
test('custo informado inválido vira null', () => {
  assert.equal(reportedCost(0.5), 0.5);
  assert.equal(reportedCost(0), 0);
  for (const v of [-1, NaN, '1', undefined]) assert.equal(reportedCost(v), null);
});
