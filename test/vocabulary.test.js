import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPERATIONS, INPUT_MODALITIES, OUTPUT_MODALITIES, METHODS_BY_OPERATION,
  formatShape, parseShape, shapeOf, requestKey, parseRequestKey, normalizeRequest,
  ineligibilityReason, isEligible, CHAT_TEXT, VocabularyError,
} from '../src/vocabulary.js';

test('vocabulário do OpenRouter', () => {
  assert.deepEqual([...INPUT_MODALITIES], ['text', 'image', 'file', 'audio', 'video']);
  assert.deepEqual([...OUTPUT_MODALITIES], ['text', 'image', 'audio', 'embeddings']);
  assert.deepEqual([...OPERATIONS], ['chat', 'decision', 'embeddings', 'transcription', 'speech', 'image-generation']);
  assert.deepEqual(METHODS_BY_OPERATION.chat, ['chat']);
  assert.deepEqual(METHODS_BY_OPERATION.decision, ['decide']);
  assert.deepEqual(METHODS_BY_OPERATION['image-generation'], ['generateImage']);
  assert.ok(Object.isFrozen(OPERATIONS) && Object.isFrozen(METHODS_BY_OPERATION.chat));
});

test('forma ↔ string na ordem canônica, sem repetição', () => {
  assert.equal(formatShape({ input: ['image', 'text', 'image'], output: ['text'] }), 'text+image->text');
  assert.equal(formatShape({ input: ['video', 'file', 'text', 'audio', 'image'], output: ['image', 'text'] }), 'text+image+file+audio+video->text+image');
  assert.deepEqual(parseShape('text+image->text'), { input: ['text', 'image'], output: ['text'] });
  assert.deepEqual(parseShape('image+text->text'), { input: ['text', 'image'], output: ['text'] });
  assert.equal(shapeOf({ input: ['image', 'text'], output: ['text'] }), 'text+image->text');
});

test('forma inválida lança VocabularyError com o valor', () => {
  assert.throws(() => parseShape('text->vector'), (e) => e instanceof VocabularyError && e.code === 'InvalidVocabulary' && /vector/.test(e.message));
  assert.throws(() => parseShape('text'), (e) => e.code === 'InvalidVocabulary');
  assert.throws(() => parseShape('->text'), (e) => e.code === 'InvalidVocabulary');
  assert.throws(() => parseShape(undefined), (e) => e.code === 'InvalidVocabulary');
  assert.throws(() => formatShape({ input: ['visual'], output: ['text'] }), (e) => e.code === 'InvalidVocabulary');
  assert.throws(() => formatShape({ input: [], output: ['text'] }), (e) => e.code === 'InvalidVocabulary');
  assert.throws(() => formatShape({ input: 'text', output: ['text'] }), (e) => e.code === 'InvalidVocabulary');
});

test('chave do pedido ida e volta', () => {
  const p = { operation: 'chat', shape: 'image+text->text' };
  assert.equal(requestKey(p), 'chat text+image->text');
  assert.deepEqual(parseRequestKey('chat text+image->text'), { operation: 'chat', shape: 'text+image->text' });
  assert.deepEqual(normalizeRequest(CHAT_TEXT), { operation: 'chat', shape: 'text->text' });
  assert.throws(() => parseRequestKey('conversar text->text'), (e) => e.code === 'InvalidVocabulary');
  assert.throws(() => parseRequestKey('chat text->text extra'), (e) => e.code === 'InvalidVocabulary');
});

test('elegibilidade: operação, entrada e saída, nessa ordem', () => {
  const model = { operations: ['chat'], input: ['text', 'image'], output: ['text'] };
  assert.equal(ineligibilityReason(model, { operation: 'chat', shape: 'text->text' }), null);
  assert.equal(ineligibilityReason(model, { operation: 'chat', shape: 'text+image->text' }), null);
  assert.ok(isEligible(model, { operation: 'chat', shape: 'image->text' }));
  assert.deepEqual(ineligibilityReason(model, { operation: 'speech', shape: 'text->audio' }), { reason: 'missing_operation', missing: ['speech'] });
  assert.deepEqual(ineligibilityReason(model, { operation: 'chat', shape: 'text+audio+video->text' }), { reason: 'missing_input', missing: ['audio', 'video'] });
  assert.deepEqual(ineligibilityReason(model, { operation: 'chat', shape: 'text->text+image' }), { reason: 'missing_output', missing: ['image'] });
  assert.equal(isEligible({}, CHAT_TEXT), false);
  assert.throws(() => isEligible(model, { operation: 'chat', shape: 'text->vector' }), (e) => e.code === 'InvalidVocabulary');
});
