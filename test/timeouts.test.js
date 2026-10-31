import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDeadline } from '../src/timeouts.js';

test('primeiro byte estoura sem touch', async () => {
  const d = createDeadline({ timeouts: { firstByteMs: 20, idleMs: 0 } });
  await sleep(40);
  assert.equal(d.reason(), 'first_byte');
  assert.ok(d.signal.aborted);
  d.clear();
});

test('touch desarma o primeiro byte e a inatividade rearma', async () => {
  const d = createDeadline({ timeouts: { firstByteMs: 30, idleMs: 30 } });
  for (let i = 0; i < 4; i++) { await sleep(15); d.touch(); }
  assert.equal(d.reason(), null);
  await sleep(50);
  assert.equal(d.reason(), 'idle');
  d.clear();
});

test('total estoura mesmo com chunks chegando', async () => {
  const d = createDeadline({ timeouts: { firstByteMs: 0, idleMs: 0, totalMs: 40 } });
  for (let i = 0; i < 5; i++) { await sleep(12); d.touch(); }
  assert.equal(d.reason(), 'total');
  d.clear();
});

test('signal do chamador vira aborted; já abortado também', async () => {
  const c = new AbortController();
  const d = createDeadline({ signal: c.signal });
  c.abort();
  assert.equal(d.reason(), 'aborted');
  assert.ok(d.signal.aborted);
  d.clear();
  const pre = new AbortController(); pre.abort();
  const d2 = createDeadline({ signal: pre.signal });
  assert.equal(d2.reason(), 'aborted');
  d2.clear();
});

test('clear solta os relógios e nada mais dispara', async () => {
  const d = createDeadline({ timeouts: { firstByteMs: 10 } });
  d.clear();
  await sleep(25);
  assert.equal(d.reason(), null);
  assert.equal(d.signal.aborted, false);
});
