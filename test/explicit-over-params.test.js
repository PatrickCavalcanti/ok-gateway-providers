// "O que o pedido traz explícito vence `params`": em cada fio, params entram primeiro e os campos de
// controle do pedido depois, num bloco só. Objetos fundem com o explícito vencendo campo a campo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getApi } from '../src/client.js';
import { resolveCompat } from '../src/compat.js';
import '../src/index.js';

const schema = { type: 'object', properties: { a: { type: 'string' } } };
const hi = [{ role: 'user', content: 'oi' }];
const tools = [{ name: 't', parameters: { type: 'object', properties: {} } }];

/** @param {string} api @param {object} compat @param {object} params @param {object} extra @param {object} [modelParams] */
function build(api, compat, params, extra = {}, modelParams = undefined) {
  const account = { id: 'x', provider: 'p', api, baseUrl: 'https://x/v1', compat };
  const model = { id: 'm', operations: ['chat'], input: ['text'], output: ['text'], ...(modelParams ? { params: modelParams } : {}) };
  return getApi(api).buildRequest({ account, model, compat: resolveCompat(account, model), apiKey: 'k', request: { messages: hi, params, ...extra } }).body;
}

test('anthropic: effort e schema explícitos fundem em output_config sem perder o resto do params', () => {
  const body = build('anthropic-messages', {}, { output_config: { effort: 'low', format: { type: 'json_schema', schema: { velho: true } }, extra: 1 } }, { effort: 'high', responseSchema: { schema } });
  assert.deepEqual(body.output_config, { effort: 'high', format: { type: 'json_schema', schema }, extra: 1 });
});

test('anthropic: params.output_config sem explícito passa inteiro', () => {
  const body = build('anthropic-messages', {}, { output_config: { effort: 'low' } });
  assert.deepEqual(body.output_config, { effort: 'low' });
});

test('anthropic: thinking explícito vence o type do params; budget_tokens não sobra em adaptive', () => {
  const body = build('anthropic-messages', {}, { thinking: { type: 'enabled', budget_tokens: 2000, display: 'summarized' } }, { effort: 'medium' });
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
  assert.equal(body.output_config.effort, 'medium');
  const off = build('anthropic-messages', {}, { thinking: { type: 'enabled', budget_tokens: 2000 } }, { effort: 'none' });
  assert.deepEqual(off.thinking, { type: 'disabled' });
});

test('anthropic: maxTokens, temperature, toolChoice e stop explícitos vencem o params', () => {
  const body = build('anthropic-messages', {}, { max_tokens: 1, temperature: 0.1, tool_choice: { type: 'none' }, stop_sequences: ['velho'] },
    { tools, maxTokens: 50, temperature: 0.7, toolChoice: 'required', stop: ['fim'] });
  assert.deepEqual([body.max_tokens, body.temperature, body.tool_choice, body.stop_sequences], [50, 0.7, { type: 'any' }, ['fim']]);
});

test('google: schema, maxTokens, temperature e stop explícitos vencem generationConfig do params; o resto fica', () => {
  const body = build('google-generative-ai', {}, { generationConfig: { responseMimeType: 'text/plain', responseJsonSchema: { velho: true }, maxOutputTokens: 1, temperature: 0.1, stopSequences: ['velho'], topK: 3 } },
    { responseSchema: { schema }, maxTokens: 50, temperature: 0.7, stop: ['fim'] });
  assert.deepEqual(body.generationConfig, { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 50, temperature: 0.7, stopSequences: ['fim'], topK: 3 });
});

test('google: toolChoice explícito vence params.toolConfig', () => {
  const body = build('google-generative-ai', {}, { toolConfig: { functionCallingConfig: { mode: 'NONE' }, retrievalConfig: { x: 1 } } }, { tools, toolChoice: 'required' });
  assert.deepEqual(body.toolConfig, { functionCallingConfig: { mode: 'ANY' }, retrievalConfig: { x: 1 } });
});

test('openai-completions: schema no topo, reasoning, maxTokens, temperature, tool_choice e stop explícitos vencem', () => {
  const sch = build('openai-completions', { structuredOutput: 'top_level_json_schema' }, { json_schema: { velho: true } }, { responseSchema: { schema } });
  assert.deepEqual(sch.json_schema, schema);
  const r = build('openai-completions', { reasoningFormat: 'reasoning_object' }, { reasoning: { max_tokens: 5, exclude: true } }, { effort: 'low' });
  assert.deepEqual(r.reasoning, { effort: 'low', exclude: true }); // effort e max_tokens não vão juntos: o explícito tira o outro
  const budget = build('openai-completions', { reasoningFormat: 'reasoning_object' }, { reasoning: { effort: 'high', exclude: true } }, { reasoning: { maxTokens: 9 } });
  assert.deepEqual(budget.reasoning, { max_tokens: 9, exclude: true });
  const e = build('openai-completions', { reasoningFormat: 'reasoning_effort' }, { reasoning_effort: 'high' }, { effort: 'low' });
  assert.equal(e.reasoning_effort, 'low');
  const c = build('openai-completions', { supportsTemperature: true }, { max_tokens: 1, temperature: 0.1, tool_choice: 'none', stop: ['velho'] }, { tools, maxTokens: 50, temperature: 0.7, toolChoice: 'required', stop: ['fim'] });
  assert.deepEqual([c.max_tokens, c.temperature, c.tool_choice, c.stop], [50, 0.7, 'required', ['fim']]);
});

test('openai-completions: params do modelo e da chamada não escondem o explícito', () => {
  const body = build('openai-completions', { reasoningFormat: 'reasoning_object' }, { reasoning: { exclude: true } }, { effort: 'low' }, { reasoning: { effort: 'high', max_tokens: 3 } });
  assert.deepEqual(body.reasoning, { effort: 'low', exclude: true });
});

test('openai-responses: effort e schema explícitos fundem em reasoning e text sem perder o resto', () => {
  const body = build('openai-responses', { reasoningFormat: 'reasoning_object', structuredOutput: 'text_format' },
    { reasoning: { effort: 'low', summary: 'auto' }, text: { format: { type: 'text' }, verbosity: 'low' }, max_output_tokens: 1, tool_choice: 'none' },
    { tools, effort: 'high', responseSchema: { schema }, maxTokens: 50, toolChoice: 'required' });
  assert.deepEqual(body.reasoning, { effort: 'high', summary: 'auto' });
  assert.deepEqual(body.text, { format: { type: 'json_schema', name: 'response', strict: true, schema }, verbosity: 'low' });
  assert.deepEqual([body.max_output_tokens, body.tool_choice], [50, 'required']);
});

test('openai-responses: sem explícito, params.reasoning e params.text passam', () => {
  const body = build('openai-responses', {}, { reasoning: { summary: 'auto' }, text: { verbosity: 'low' } });
  assert.deepEqual([body.reasoning, body.text], [{ summary: 'auto' }, { verbosity: 'low' }]);
});

test('embeddings: dimensions do pedido vence params.dimensions', () => {
  const account = { id: 'x', provider: 'p', api: 'openai-completions', baseUrl: 'https://x/v1' };
  const model = { id: 'm', operations: ['embeddings'], input: ['text'], output: ['embeddings'] };
  const op = getApi('openai-completions').operations.embeddings;
  const { body } = op.buildRequest({ account, model, compat: resolveCompat(account, model), apiKey: 'k', request: { texts: ['a'], dimensions: 768, params: { dimensions: 4 } } });
  assert.equal(body.dimensions, 768);
  const { body: semExplicito } = op.buildRequest({ account, model, compat: resolveCompat(account, model), apiKey: 'k', request: { texts: ['a'], params: { dimensions: 4 } } });
  assert.equal(semExplicito.dimensions, 4);
});
