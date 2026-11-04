import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub, selectHeaders, describeBody } from '../scripts/record-fixture-lib.mjs';

test('scrub remove a chave informada e os formatos conhecidos', () => {
  const key = 'chave-do-ambiente-123';
  const text = `usou ${key} e sk-abc1234567890 e AIzaSyD1234567890abc e Bearer xyz1234567890`;
  assert.equal(
    scrub(text, key),
    'usou <REDACTED> e <REDACTED> e <REDACTED> e Bearer <REDACTED>',
  );
});

test('scrub sem chave ainda limpa os formatos e o cabeçalho x-goog-api-key', () => {
  assert.equal(scrub('x-goog-api-key: AIzaSyD1234567890abc', undefined), 'x-goog-api-key: <REDACTED>');
  assert.equal(scrub('texto sem segredo', undefined), 'texto sem segredo');
});

test('describeBody descreve FormData: campo de texto e arquivo por nome, tipo e tamanho', () => {
  const form = new FormData();
  form.append('model', 'x');
  form.append('file', new File([new Uint8Array(5)], 'a.mp3', { type: 'audio/mpeg' }));
  assert.deepEqual(describeBody(form), {
    model: 'x',
    file: { name: 'a.mp3', type: 'audio/mpeg', bytes: 5 },
  });
});

test('describeBody devolve objeto comum como está', () => {
  const obj = { model: 'x', input: ['a'] };
  assert.equal(describeBody(obj), obj);
});

test('selectHeaders guarda só content-type e x-generation-id', () => {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Generation-Id': 'gen-1',
    Authorization: 'Bearer segredo-123456',
    'Set-Cookie': 'sid=abc',
  });
  assert.deepEqual(selectHeaders(headers), {
    'content-type': 'application/json',
    'x-generation-id': 'gen-1',
  });
});
