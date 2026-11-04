// ok-gateway-providers — transcrição no fio openai-completions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcription } from '../src/apis/openai-completions/transcription.js';
import { resolveCompat } from '../src/compat.js';

const account = { id: 'a', provider: 'p', api: 'openai-completions', baseUrl: 'https://x/v1', apiKey: 'k' };
const model = { id: 'whisper-1' };
const compat = resolveCompat(account, model);

/** @param {any} corpo */
const resposta = (corpo) => ({ status: 200, headers: new Headers(), json: async () => corpo, bytes: async () => new Uint8Array() });

/** @param {any} request @param {any} [extra] */
const build = (request, extra = {}) => transcription.buildRequest({ account, model, compat, request, apiKey: 'k', ...extra });

/** @param {any} request @param {any} [extra] */
const parse = (request, corpo, extra = {}) =>
  transcription.parseResponse(resposta(corpo), { account, model, compat, request, ...extra });

const audio = () => new Uint8Array([1, 2, 3, 4]);

/** Erro `invalid_request` sem retry em outro provedor. @param {unknown} e */
const invalid = (e) => e instanceof Error && /** @type {any} */ (e).type === 'invalid_request' && /** @type {any} */ (e).retryOther === false;

test('sem filename o arquivo é audio.<formato> com o tipo do mime', () => {
  const { body } = build({ audio: audio(), mime: 'audio/mpeg' });
  const file = body.get('file');
  assert.equal(file.name, 'audio.mp3');
  assert.equal(file.type, 'audio/mpeg');
  assert.equal(body.get('model'), 'whisper-1');
  assert.equal(body.get('response_format'), 'json');
});

test('response_format segue compat.sttResponseFormat', () => {
  const { body } = build({ audio: audio(), mime: 'audio/mpeg' }, { compat: { ...compat, sttResponseFormat: 'verbose_json' } });
  assert.equal(body.get('response_format'), 'verbose_json');
});

test('language e prompt ausentes não viram campo', () => {
  const { body } = build({ audio: audio(), mime: 'audio/mpeg' });
  assert.equal(body.has('language'), false);
  assert.equal(body.has('prompt'), false);
});

test('language e prompt presentes viram campo', () => {
  const { body } = build({ audio: audio(), mime: 'audio/mpeg', language: 'pt', prompt: 'nomes' });
  assert.equal(body.get('language'), 'pt');
  assert.equal(body.get('prompt'), 'nomes');
});

test('audio vazio é invalid_request sem retry', () => {
  assert.throws(() => build({ audio: new Uint8Array(), mime: 'audio/mpeg' }), invalid);
});

test('audio sem mime é invalid_request sem retry', () => {
  assert.throws(() => build({ audio: audio() }), invalid);
});

test('sem chave não há header Authorization', () => {
  const { headers } = build({ audio: audio(), mime: 'audio/mpeg' }, { apiKey: '' });
  assert.equal('Authorization' in headers, false);
  assert.deepEqual(headers, {});
});

test('com chave o header Authorization tem o Bearer', () => {
  const { url, headers } = build({ audio: audio(), mime: 'audio/mpeg' });
  assert.equal(url, 'https://x/v1/audio/transcriptions');
  assert.equal(headers.Authorization, 'Bearer k');
});

test('duration vira durationSeconds e usage.audioSeconds', async () => {
  const { result, usage } = await parse({ audio: audio(), mime: 'audio/mpeg' }, { text: 'oi', duration: 12.5 });
  assert.equal(result.text, 'oi');
  assert.equal(result.durationSeconds, 12.5);
  assert.equal(usage.audioSeconds, 12.5);
});

test('sem duration, o fim do último segmento vira durationSeconds', async () => {
  const { result } = await parse({ audio: audio(), mime: 'audio/mpeg' }, { text: 'oi', segments: [{ end: 3 }, { end: 7 }] });
  assert.equal(result.durationSeconds, 7);
});

test('tokens da transcrição viram uso', async () => {
  const { usage } = await parse({ audio: audio(), mime: 'audio/mpeg' }, { text: 'oi', usage: { input_tokens: 5, output_tokens: 2 } });
  assert.equal(usage.input, 5);
  assert.equal(usage.output, 2);
});

test('resposta só com text tem uso missing', async () => {
  const { result, usage } = await parse({ audio: audio(), mime: 'audio/mpeg' }, { text: 'oi' });
  assert.equal(result.text, 'oi');
  assert.equal(result.durationSeconds, undefined);
  assert.equal(usage.missing, true);
});

test('resposta sem text é upstream', async () => {
  await assert.rejects(
    () => parse({ audio: audio(), mime: 'audio/mpeg' }, { duration: 1 }),
    (e) => /** @type {any} */ (e).type === 'upstream',
  );
});
