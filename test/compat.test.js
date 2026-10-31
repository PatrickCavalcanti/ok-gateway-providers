import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCompat, DEFAULT_COMPAT } from '../src/compat.js';

test('conta genérica openai-completions nasce conservadora (spec §6)', () => {
  const c = resolveCompat({ api: 'openai-completions' });
  assert.equal(c.maxTokensField, 'max_tokens');
  assert.equal(c.supportsDeveloperRole, false);
  assert.equal(c.supportsStore, false);
  assert.equal(c.structuredOutput, 'none');
  assert.equal(c.usageInStream, false);
  assert.equal(c.cacheMarker, 'none');
  assert.equal(c.reasoningFormat, 'none');
  assert.deepEqual(c.headers, {});
});

test('padrão anthropic-messages', () => {
  const c = resolveCompat({ api: 'anthropic-messages' });
  assert.equal(c.reasoningFormat, 'anthropic_thinking');
  assert.equal(c.structuredOutput, 'output_config');
  assert.equal(c.cacheMarker, 'cache_control');
  assert.equal(c.usageInStream, true);
});

test('modelo sobrescreve a conta campo a campo; headers fazem merge', () => {
  const c = resolveCompat(
    { api: 'openai-completions', compat: { structuredOutput: 'response_format', usageInStream: true, headers: { 'X-Title': 'Igris', 'HTTP-Referer': 'a' } } },
    { compat: { structuredOutput: 'none', maxTokensField: 'max_completion_tokens', headers: { 'HTTP-Referer': 'b' } } },
  );
  assert.equal(c.structuredOutput, 'none');
  assert.equal(c.usageInStream, true);
  assert.equal(c.maxTokensField, 'max_completion_tokens');
  assert.deepEqual(c.headers, { 'X-Title': 'Igris', 'HTTP-Referer': 'b' });
});

test('undefined não apaga o padrão e o padrão não é mutado', () => {
  const c = resolveCompat({ api: 'openai-completions', compat: { usageInStream: undefined } });
  assert.equal(c.usageInStream, false);
  c.headers.x = '1';
  assert.deepEqual(DEFAULT_COMPAT['openai-completions'].headers, {});
});
