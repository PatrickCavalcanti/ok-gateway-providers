// Anexo de arquivo (PDF, texto…) nos dois fios: formato, validação antes do fetch e cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest as buildOpenAI } from '../src/apis/openai-completions.js';
import { buildRequest as buildAnthropic } from '../src/apis/anthropic-messages.js';
import { resolveCompat } from '../src/compat.js';
import { createClient } from '../src/index.js';
import { ProviderError } from '../src/errors.js';
import { defaultFilename } from '../src/attachments.js';

const PDF = Buffer.from('%PDF-1.4 teste').toString('base64');
const TXT = Buffer.from('olá, documento').toString('base64');

/** @param {any} api @param {any} [o] */
function build(api, o = {}) {
  const account = /** @type {any} */ ({ id: 'a', provider: 'p', api, baseUrl: 'https://h/v1', ...(o.account ?? {}) });
  const model = /** @type {any} */ ({ id: 'm', operations: ['chat'], input: ['text', 'file'], output: ['text'], ...(o.model ?? {}) });
  const fn = api === 'openai-completions' ? buildOpenAI : buildAnthropic;
  return fn({ account, model, compat: resolveCompat(account, model), request: o.request, apiKey: 'k' }).body;
}

/** @param {any[]} content */
const req = (content) => ({ messages: [{ role: 'user', content }] });

test('openai-completions: PDF vira parte file com filename e data-url', () => {
  const body = build('openai-completions', { request: req([{ type: 'text', text: 'resuma' }, { type: 'file', data: PDF, mime: 'application/pdf', name: 'contrato.pdf' }]) });
  assert.deepEqual(body.messages[0].content[1], { type: 'file', file: { filename: 'contrato.pdf', file_data: `data:application/pdf;base64,${PDF}` } });
});

test('openai-completions: sem name ganha nome pelo mime; data-url pronta passa como veio', () => {
  const body = build('openai-completions', { request: req([{ type: 'file', data: `data:text/plain;base64,${TXT}` }]) });
  assert.deepEqual(body.messages[0].content[0], { type: 'file', file: { filename: 'arquivo.txt', file_data: `data:text/plain;base64,${TXT}` } });
  assert.equal(defaultFilename('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'arquivo.docx');
  assert.equal(defaultFilename(undefined), 'arquivo');
});

test('openai-completions: URL só com transport.file declarando url', () => {
  const part = { type: 'file', url: 'https://x/doc.pdf', mime: 'application/pdf' };
  assert.throws(() => build('openai-completions', { request: req([part]) }), (e) => e instanceof ProviderError && e.type === 'unsupported');
  const body = build('openai-completions', { model: { transport: { file: ['data-url', 'url'] } }, request: req([part]) });
  assert.equal(body.messages[0].content[0].file.file_data, 'https://x/doc.pdf');
});

test('os dois fios: modelo sem file na entrada dá unsupported; base64 sem mime dá invalid_request', () => {
  for (const api of ['openai-completions', 'anthropic-messages']) {
    assert.throws(() => build(api, { model: { input: ['text'] }, request: req([{ type: 'file', data: PDF, mime: 'application/pdf' }]) }), (e) => e instanceof ProviderError && e.type === 'unsupported', api);
    assert.throws(() => build(api, { request: req([{ type: 'file', data: PDF }]) }), (e) => e instanceof ProviderError && e.type === 'invalid_request', api);
  }
});

test('anthropic-messages: PDF vira bloco document base64 com título', () => {
  const body = build('anthropic-messages', { request: req([{ type: 'file', data: PDF, mime: 'application/pdf', name: 'contrato.pdf' }, { type: 'text', text: 'resuma' }]) });
  assert.deepEqual(body.messages[0].content[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF }, title: 'contrato.pdf' });
});

test('anthropic-messages: texto puro vira document de texto decodificado; PDF por URL', () => {
  const t = build('anthropic-messages', { request: req([{ type: 'file', data: TXT, mime: 'text/plain' }]) });
  assert.deepEqual(t.messages[0].content[0], { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'olá, documento' } });
  const u = build('anthropic-messages', { model: { transport: { file: ['url'] } }, request: req([{ type: 'file', url: 'https://x/doc.pdf' }]) });
  assert.deepEqual(u.messages[0].content[0], { type: 'document', source: { type: 'url', url: 'https://x/doc.pdf' } });
});

test('anthropic-messages: docx não é lido pela Messages API e dá unsupported, nunca some', () => {
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  assert.throws(() => build('anthropic-messages', { request: req([{ type: 'file', data: PDF, mime: docx }]) }), (e) => e instanceof ProviderError && e.type === 'unsupported' && /PDF ou text\/plain/.test(e.message));
});

test('anthropic-messages: arquivo com marca de cache leva cache_control', () => {
  const body = build('anthropic-messages', { request: req([{ type: 'file', data: PDF, mime: 'application/pdf', cache: { ttl: '1h' } }]) });
  assert.deepEqual(body.messages[0].content[0].cache_control, { type: 'ephemeral', ttl: '1h' });
});

test('arquivo não suportado não chama o fetch', async () => {
  let calls = 0;
  const fetch = /** @type {any} */ (async () => { calls++; throw new Error('não devia'); });
  const account = /** @type {any} */ ({ id: 'a', provider: 'openrouter', api: 'openai-completions', baseUrl: 'https://h/v1', apiKey: 'k' });
  const model = /** @type {any} */ ({ id: 'm', operations: ['chat'], input: ['text'], output: ['text'] });
  const run = createClient({ account, model, fetch }).chat({ messages: [{ role: 'user', content: [{ type: 'file', data: PDF, mime: 'application/pdf' }] }] });
  await assert.rejects(run.result, (e) => e instanceof ProviderError && e.type === 'unsupported' && !e.emitted);
  assert.equal(calls, 0);
});
