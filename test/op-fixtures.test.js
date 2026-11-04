// Respostas reais de provedores, gravadas em test/fixtures/operations (2026-11-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCompat } from '../src/compat.js';
import { operations } from '../src/apis/openai-completions.js';

const dir = new URL('./fixtures/operations/', import.meta.url);

function response(name, { binary = false } = {}) {
  const meta = JSON.parse(readFileSync(new URL(`${name}.meta.json`, dir), 'utf8'));
  const raw = readFileSync(new URL(name, dir));
  return {
    status: meta.status,
    headers: new Headers(meta.headers),
    json: async () => JSON.parse(raw.toString('utf8')),
    bytes: async () => new Uint8Array(raw),
    binary,
  };
}

function ctx(operation, request, compat = {}) {
  const account = { id: 'a', provider: 'p', api: 'openai-completions', baseUrl: 'https://x/v1', apiKey: 'k', compat };
  const model = { id: 'm', operations: [operation], input: ['text'], output: ['text'] };
  return { account, model, compat: resolveCompat(account, model), request };
}

test('embeddings OpenAI', async () => {
  const r = await operations.embeddings.parseResponse(response('embeddings-openai.json'), ctx('embeddings', { texts: ['a', 'b'] }));
  assert.equal(r.result.vectors.length, 2);
  assert.equal(r.result.vectors[0].length, 1536);
  assert.equal(r.usage.input, 4);
  assert.equal(r.reportedCostUsd, null);
});

test('STT Groq: duração em segundos, sem custo informado', async () => {
  const r = await operations.transcription.parseResponse(response('stt-groq.json'), ctx('transcription', {}));
  assert.match(r.result.text, /Teste de transcrição/);
  assert.equal(r.result.durationSeconds, 2.184);
  assert.equal(r.usage.audioSeconds, 2.184);
});

test('STT OpenAI gpt-4o-transcribe: por token', async () => {
  const r = await operations.transcription.parseResponse(response('stt-openai.json'), ctx('transcription', {}));
  assert.match(r.result.text, /Teste de transcrição/);
  assert.equal(r.result.durationSeconds, undefined);
  assert.deepEqual([r.usage.input, r.usage.output], [21, 10]);
});

test('TTS OpenAI: mp3', async () => {
  const r = await operations.speech.parseResponse(response('tts-openai.bin'), ctx('speech', { text: 'abc', format: 'mp3' }));
  assert.ok(r.result.audio.length > 1000);
  assert.equal(r.result.contentType, 'audio/mpeg');
  assert.equal(r.usage.input, 3);
});

test('TTS OpenRouter: pcm com a taxa no content-type e X-Generation-Id', async () => {
  const r = await operations.speech.parseResponse(response('tts-openrouter.bin'), ctx('speech', { text: 'abc' }));
  assert.equal(r.result.contentType, 'audio/pcm;rate=24000;channels=1');
  assert.match(r.usage.raw.generationId, /^gen-tts-/);
});

test('imagem OpenRouter: custo informado', async () => {
  const r = await operations['image-generation'].parseResponse(response('image-openrouter.json'), ctx('image-generation', { params: { n: 1 } }));
  assert.equal(r.result.images.length, 1);
  assert.equal(r.result.images[0].mediaType, 'image/png');
  assert.equal(r.reportedCostUsd, 0.03);
});

test('decisão OpenRouter: answers e custo', async () => {
  const r = await operations.decision.parseResponse(response('decision-openrouter.json'), ctx('decision', {}));
  assert.equal(r.result.answers.pronto.type, 'noul');
  assert.equal(r.usage.input, 305);
  assert.equal(r.reportedCostUsd, 0.00001281);
});

test('decisão TypeSafe: sem custo informado', async () => {
  const r = await operations.decision.parseResponse(response('decision-typesafe.json'), ctx('decision', {}));
  assert.equal(r.result.answers.pronto.type, 'noul');
  assert.equal(r.reportedCostUsd, null);
});
