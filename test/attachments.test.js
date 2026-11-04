import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertMediaSupported, toOpenAIContent, mediaFormat } from '../src/attachments.js';
import { ProviderError } from '../src/errors.js';

const provider = 'acme';
const model = (extra = {}) => ({ id: 'acme/m', operations: ['chat'], input: ['text', 'image', 'audio', 'video'], output: ['text'], ...extra });
const compat = { cacheMarker: 'none' };
const convert = (content, m = model(), c = compat) => toOpenAIContent(content, { model: m, compat: c, provider });
const unsupportedErr = (e) => e instanceof ProviderError && e.type === 'unsupported' && e.retryOther === true;

test('string vira uma parte de texto', () => {
  assert.deepEqual(convert('oi'), [{ type: 'text', text: 'oi' }]);
});

test('imagem: data-url com mime, data-url já pronto e URL', () => {
  assert.deepEqual(convert([
    { type: 'image', data: 'QUJD', mime: 'image/png' },
    { type: 'image', data: 'data:image/webp;base64,UVJT' },
    { type: 'image', url: 'https://i.test/x.jpg' },
  ]), [
    { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    { type: 'image_url', image_url: { url: 'data:image/webp;base64,UVJT' } },
    { type: 'image_url', image_url: { url: 'https://i.test/x.jpg' } },
  ]);
});

test('transport.image: só data-url recusa URL; só url recusa base64; [] recusa tudo', () => {
  const url = { type: 'image', url: 'https://i.test/x.jpg' };
  const data = { type: 'image', data: 'QUJD', mime: 'image/png' };
  assert.throws(() => convert([url], model({ transport: { image: ['data-url'] } })), unsupportedErr);
  assert.throws(() => convert([data], model({ transport: { image: ['url'] } })), unsupportedErr);
  assert.doesNotThrow(() => convert([url], model({ transport: { image: ['url'] } })));
  for (const p of [url, data]) assert.throws(() => convert([p], model({ transport: { image: [] } })), unsupportedErr);
});

test('modalidade fora de model.input é unsupported, mesmo com transporte declarado', () => {
  const textOnly = model({ input: ['text'], transport: { image: ['data-url'], audio: 'input_audio', video: 'video_url' } });
  for (const p of [
    { type: 'image', data: 'QUJD', mime: 'image/png' },
    { type: 'audio', data: 'QUJD', format: 'wav' },
    { type: 'video', url: 'https://v.test/a.mp4', mime: 'video/mp4' },
  ]) {
    assert.throws(() => assertMediaSupported(p, textOnly, { provider }), unsupportedErr, p.type);
  }
});

test('imagem sem dado, ou base64 sem mime, é invalid_request sem retryOther', () => {
  const bad = (e) => e.type === 'invalid_request' && e.retryOther === false;
  assert.throws(() => convert([{ type: 'image' }]), bad);
  assert.throws(() => convert([{ type: 'image', data: 'QUJD' }]), bad);
});

test('áudio: input_audio com data e format', () => {
  assert.deepEqual(convert([{ type: 'audio', data: 'UklG', format: 'wav' }]), [
    { type: 'input_audio', input_audio: { data: 'UklG', format: 'wav' } },
  ]);
  assert.throws(() => convert([{ type: 'audio', data: 'UklG', format: 'wav' }], model({ transport: { audio: null } })), unsupportedErr);
  assert.throws(() => convert([{ type: 'audio', data: 'UklG' }]), (e) => e.type === 'invalid_request');
});

test('vídeo: input_video leva base64 + format do mime; video_url leva URL ou data-url', () => {
  const asInput = model({ transport: { video: 'input_video' } });
  assert.deepEqual(convert([{ type: 'video', data: 'AAAA', mime: 'video/quicktime' }], asInput), [
    { type: 'input_video', input_video: { data: 'AAAA', format: 'mov' } },
  ]);
  assert.throws(() => convert([{ type: 'video', url: 'https://v.test/a.mp4', mime: 'video/mp4' }], asInput), unsupportedErr);

  const asUrl = model({ transport: { video: 'video_url' } });
  assert.deepEqual(convert([
    { type: 'video', url: 'https://v.test/a.mp4', mime: 'video/mp4' },
    { type: 'video', data: 'AAAA', mime: 'video/mp4' },
  ], asUrl), [
    { type: 'video_url', video_url: { url: 'https://v.test/a.mp4' } },
    { type: 'video_url', video_url: { url: 'data:video/mp4;base64,AAAA' } },
  ]);

  // sem transport.video declarado o vídeo não sai: nenhum formato é adivinhado
  assert.throws(() => convert([{ type: 'video', data: 'AAAA', mime: 'video/mp4' }]), unsupportedErr);
  assert.throws(() => convert([{ type: 'video', data: 'AAAA', mime: 'video/mp4' }], model({ transport: { video: null } })), unsupportedErr);
});

test('mediaFormat normaliza o subtipo', () => {
  assert.equal(mediaFormat('video/mp4'), 'mp4');
  assert.equal(mediaFormat('video/x-msvideo'), 'avi');
  assert.equal(mediaFormat('video/x-matroska'), 'mkv');
  assert.equal(mediaFormat('audio/mpeg'), 'mp3');
  assert.equal(mediaFormat('audio/wav; codecs=1'), 'wav');
});

test('marca de cache: cache_control só com cacheMarker cache_control, ttl só quando pedido', () => {
  const parts = [{ type: 'text', text: 'a', cache: { ttl: '1h' } }, { type: 'text', text: 'b', cache: {} }, { type: 'text', text: 'c' }];
  assert.deepEqual(convert(parts, model(), { cacheMarker: 'cache_control' }), [
    { type: 'text', text: 'a', cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: 'b', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'c' },
  ]);
  assert.deepEqual(convert(parts, model(), { cacheMarker: 'prompt_cache_breakpoint' }), [
    { type: 'text', text: 'a', prompt_cache_breakpoint: { mode: 'explicit' } },
    { type: 'text', text: 'b', prompt_cache_breakpoint: { mode: 'explicit' } },
    { type: 'text', text: 'c' },
  ]);
  assert.deepEqual(convert(parts, model(), { cacheMarker: 'none' }).map((p) => Object.keys(p).length), [2, 2, 2]);
});

test('assertMediaSupported: texto passa; a mensagem diz provedor/modelo e o motivo', () => {
  assert.doesNotThrow(() => assertMediaSupported({ type: 'text', text: 'x' }, model({ input: ['text'] }), { provider }));
  assert.throws(
    () => assertMediaSupported({ type: 'image', data: 'QUJD', mime: 'image/png' }, model({ input: ['text'] }), { provider }),
    (e) => unsupportedErr(e) && /acme\/acme\/m/.test(e.message) && /image/.test(e.message) && e.provider === 'acme' && e.model === 'acme/m',
  );
});

test('inline_data aceita áudio e vídeo em base64', () => {
  const m = { id: 'm', input: ['audio', 'video'], transport: { audio: 'inline_data', video: 'inline_data' } };
  assertMediaSupported({ type: 'audio', data: 'QQ==', format: 'mp3' }, m);
  assertMediaSupported({ type: 'video', data: 'QQ==', mime: 'video/mp4' }, m);
});
test('inline_data recusa vídeo por URL e vídeo sem mime', () => {
  const m = { id: 'm', input: ['video'], transport: { video: 'inline_data' } };
  assert.throws(() => assertMediaSupported({ type: 'video', url: 'https://x/v.mp4' }, m), (e) => e.type === 'unsupported');
  assert.throws(() => assertMediaSupported({ type: 'video', data: 'QQ==' }, m), (e) => e.type === 'invalid_request');
});

test('áudio e vídeo em data-url dispensam format e mime: o prefixo já os traz', () => {
  const audio = { id: 'm', input: ['audio'], transport: { audio: 'inline_data' } };
  const video = { id: 'm', input: ['video'], transport: { video: 'inline_data' } };
  assertMediaSupported({ type: 'audio', data: 'data:audio/mp3;base64,QQ==' }, audio);
  assertMediaSupported({ type: 'audio', data: 'data:audio/mp3;base64,QQ==' }, { ...audio, transport: { audio: 'input_audio' } });
  assertMediaSupported({ type: 'video', data: 'data:video/mp4;base64,QQ==' }, video);
  assertMediaSupported({ type: 'video', data: 'data:video/mp4;base64,QQ==' }, { ...video, transport: { video: 'input_video' } });
  // prefixo sem mime não resolve nada: continua exigindo
  assert.throws(() => assertMediaSupported({ type: 'audio', data: 'data:;base64,QQ==' }, audio), (e) => e.type === 'invalid_request' && e.retryOther === false);
  assert.throws(() => assertMediaSupported({ type: 'video', data: 'data:;base64,QQ==' }, video), (e) => e.type === 'invalid_request' && e.retryOther === false);
  // base64 solto continua exigindo
  assert.throws(() => assertMediaSupported({ type: 'audio', data: 'QQ==' }, audio), (e) => e.type === 'invalid_request');
});

test('openai: áudio e vídeo em data-url saem sem o prefixo, com o formato tirado dele', () => {
  const asInput = model({ transport: { video: 'input_video' } });
  assert.deepEqual(convert([{ type: 'audio', data: 'data:audio/mpeg;base64,UklG' }]), [
    { type: 'input_audio', input_audio: { data: 'UklG', format: 'mp3' } },
  ]);
  assert.deepEqual(convert([{ type: 'video', data: 'data:video/quicktime;base64,AAAA' }], asInput), [
    { type: 'input_video', input_video: { data: 'AAAA', format: 'mov' } },
  ]);
  // format/mime explícitos continuam valendo sobre o do prefixo
  assert.deepEqual(convert([{ type: 'audio', data: 'data:audio/mpeg;base64,UklG', format: 'wav' }]), [
    { type: 'input_audio', input_audio: { data: 'UklG', format: 'wav' } },
  ]);
  assert.deepEqual(convert([{ type: 'video', data: 'data:video/quicktime;base64,AAAA', mime: 'video/mp4' }], asInput), [
    { type: 'input_video', input_video: { data: 'AAAA', format: 'mp4' } },
  ]);
});
