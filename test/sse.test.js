import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSSE } from '../src/sse.js';

/** @param {string[]} chunks */
function stream(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
  });
}

/** @param {AsyncIterable<any>} it */
async function all(it) { const out = []; for await (const x of it) out.push(x); return out; }

test('eventos com \\n, \\r\\n, várias linhas data e comentários', async () => {
  const evs = await all(readSSE(stream([
    ': ping\n\n',
    'event: message_start\ndata: {"a":1}\n\n',
    'data: linha1\r\ndata: linha2\r\n\r\n',
    'data: [DONE]\n\n',
  ])));
  assert.deepEqual(evs, [
    { event: 'message_start', data: '{"a":1}' },
    { data: 'linha1\nlinha2' },
    { data: '[DONE]' },
  ]);
});

test('evento partido entre chunks, inclusive no meio de \\r\\n e de um caractere UTF-8', async () => {
  const bytes = new TextEncoder().encode('data: olá\r\n\r\ndata: fim\n\n');
  const cut = bytes.indexOf(0xc3) + 1; // no meio do "á"
  const crlf = bytes.indexOf(0x0d) + 1; // logo depois do primeiro \r
  const parts = [bytes.subarray(0, cut), bytes.subarray(cut, crlf), bytes.subarray(crlf)];
  const body = new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } });
  let chunks = 0;
  const evs = await all(readSSE(body, { onChunk: () => chunks++ }));
  assert.deepEqual(evs, [{ data: 'olá' }, { data: 'fim' }]);
  assert.equal(chunks, 3);
});

test('último evento sem linha em branco no fim ainda sai', async () => {
  const evs = await all(readSSE(stream(['data: a\n\ndata: b'])));
  assert.deepEqual(evs, [{ data: 'a' }, { data: 'b' }]);
});

test('aceita async iterable de strings', async () => {
  async function* gen() { yield 'data: x\n'; yield '\n'; }
  assert.deepEqual(await all(readSSE(gen())), [{ data: 'x' }]);
});
