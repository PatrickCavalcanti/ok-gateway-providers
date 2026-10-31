// Regressões da segunda revisão do conjunto: tool call cortada nos dois fios e headers sem caixa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../src/index.js';

/** @param {string} text */
const sse = (text) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }));
const msgs = [{ role: /** @type {const} */ ('user'), content: 'oi' }];
const anAccount = /** @type {any} */ ({ id: 'an', provider: 'anthropic', api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k' });
const anModel = /** @type {any} */ ({ id: 'claude', operations: ['chat'], input: ['text'], output: ['text'] });

/** @param {string} partial @param {string} stop */
function anthropicTool(partial, stop) {
  return [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3,"output_tokens":1}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"write","input":{}}}\n\n',
    `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: partial } })}\n\n`,
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stop}"},"usage":{"output_tokens":9}}\n\n`,
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ].join('');
}

/** @param {any} run */
async function events(run) { const out = []; for await (const ev of run) out.push(ev); return out; }

test('anthropic: tool_use cortado por max_tokens não sai como tool_call completo', async () => {
  const fetch = /** @type {any} */ (async () => sse(anthropicTool('{"path":"a.txt","content":"', 'max_tokens')));
  const run = lib.createClient({ account: anAccount, model: anModel, fetch }).chat({ messages: msgs });
  await assert.rejects(events(run), (e) => e instanceof lib.ProviderError && e.type === 'upstream' && /cortada/.test(e.message));
});

test('anthropic: max_tokens com tool_use cujo JSON fecha mas é o último bloco também é cortado', async () => {
  const fetch = /** @type {any} */ (async () => sse(anthropicTool('{"path":"a.txt"}', 'max_tokens')));
  const run = lib.createClient({ account: anAccount, model: anModel, fetch }).chat({ messages: msgs });
  await assert.rejects(run.result, (e) => e instanceof lib.ProviderError && /max_tokens/.test(e.message));
});

test('anthropic: tool_use completo sai no fim, com tool_calls', async () => {
  const fetch = /** @type {any} */ (async () => sse(anthropicTool('{"path":"a.txt"}', 'tool_use')));
  const run = lib.createClient({ account: anAccount, model: anModel, fetch }).chat({ messages: msgs });
  const evs = await events(run);
  assert.deepEqual(evs[0], { type: 'tool_call', id: 't1', name: 'write', arguments: '{"path":"a.txt"}' });
  assert.equal((await run.result).finishReason, 'tool_calls');
});

const orAccount = /** @type {any} */ ({ id: 'or', provider: 'openrouter', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', headers: { Authorization: 'Bearer conta', 'X-Extra': '1' } });
const orModel = /** @type {any} */ ({ id: 'x/y', operations: ['chat'], input: ['text'], output: ['text'] });

/** @param {string} args @param {string} finish */
function openaiTool(args, finish) {
  return [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'f', arguments: args } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'texto até o limite' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`,
    'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
    'data: [DONE]\n\n',
  ].join('');
}

test('openai: tool call completa com finish length não derruba a resposta', async () => {
  const fetch = /** @type {any} */ (async () => sse(openaiTool('{"a":1}', 'length')));
  const run = lib.createClient({ account: orAccount, model: orModel, fetch }).chat({ messages: msgs });
  const evs = await events(run);
  assert.ok(evs.some((e) => e.type === 'tool_call' && e.arguments === '{"a":1}'));
});

test('openai: tool call com JSON cortado e finish length dá erro', async () => {
  const fetch = /** @type {any} */ (async () => sse(openaiTool('{"a":', 'length')));
  const run = lib.createClient({ account: orAccount, model: orModel, fetch }).chat({ messages: msgs });
  await assert.rejects(run.result, (e) => e instanceof lib.ProviderError && /cortada/.test(e.message));
});

test('headers com caixa diferente não se somam: o do fio vence', async () => {
  /** @type {any} */ let headers;
  const fetch = /** @type {any} */ (async (/** @type {string} */ _u, /** @type {any} */ init) => {
    headers = init.headers;
    return sse('data: {"choices":[{"index":0,"delta":{"content":"oi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await lib.createClient({ account: orAccount, model: orModel, fetch }).chat({ messages: msgs }).result;
  assert.equal(new Headers(headers).get('authorization'), 'Bearer k');
  assert.equal(new Headers(headers).get('x-extra'), '1');
  assert.equal(Object.keys(headers).filter((k) => k.toLowerCase() === 'authorization').length, 1);
});
