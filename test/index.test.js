// Integração pela porta pública: os dois fios registrados e os exports da spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../src/index.js';

test('index registra os dois fios do núcleo', () => {
  assert.deepEqual(lib.listApis().sort(), ['anthropic-messages', 'openai-completions']);
});

test('exports públicos da spec existem', () => {
  for (const name of [
    'createClient', 'ProviderError', 'computeCost', 'createCreditConverter', 'parseOpenRouterModels',
    'resolveCompat', 'readSSE', 'createDeadline', 'OPERATIONS', 'INPUT_MODALITIES', 'OUTPUT_MODALITIES',
    'formatShape', 'parseShape', 'shapeOf', 'requestKey', 'isEligible', 'ineligibilityReason', 'METHODS_BY_OPERATION',
  ]) assert.ok(name in lib, name);
});

/** @param {string} text */
const sseResponse = (text) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }));

test('catálogo → cliente → chat pelo openai-completions, custo do provedor e créditos', async () => {
  const [model] = lib.parseOpenRouterModels({ data: [{
    id: 'acme/m1', name: 'M1', context_length: 1000,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    supported_parameters: ['temperature', 'structured_outputs'],
  }] });
  /** @type {any} */ let sent;
  const fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    sent = { url, body: JSON.parse(init.body) };
    return sseResponse([
      'data: {"choices":[{"index":0,"delta":{"content":"oi"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"cost":0.00002}}\n\n',
      'data: [DONE]\n\n',
    ].join(''));
  });
  const account = /** @type {any} */ ({ id: 'or', provider: 'openrouter', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1/', apiKey: 'k' });
  const run = lib.createClient({ account, model, fetch }).chat({ messages: [{ role: 'user', content: 'oi' }] });
  let text = '';
  for await (const ev of run) if (ev.type === 'text') text += ev.text;
  const r = await run.result;
  assert.equal(text, 'oi');
  assert.equal(sent.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(sent.body.stream_options?.include_usage, true); // o catálogo liga usageInStream
  assert.deepEqual(r.cost, { usd: 0.00002, source: 'provider' });
  assert.equal(r.usage.input, 10);
  assert.equal(lib.createCreditConverter({ creditsPerUsd: 5500, rounding: 'round', decimals: 6 }).toCredits(r.cost.usd), 0.11);
});

test('anthropic-messages pela porta pública', async () => {
  const fetch = /** @type {any} */ (async () => sseResponse([
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3,"output_tokens":1}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"olá"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ].join('')));
  const account = /** @type {any} */ ({ id: 'an', provider: 'anthropic', api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k' });
  const model = /** @type {any} */ ({ id: 'claude-haiku-5-5', operations: ['chat'], input: ['text'], output: ['text'] });
  const r = await lib.createClient({ account, model, fetch }).chat({ messages: [{ role: 'user', content: 'oi' }] }).result;
  assert.equal(r.finishReason, 'stop');
  assert.equal(r.usage.output, 2);
  assert.deepEqual(r.cost, { usd: null, source: 'none' });
});
