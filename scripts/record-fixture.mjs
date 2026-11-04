#!/usr/bin/env node
// ok-gateway-providers — grava uma fixture a partir de uma chamada real (spec §8).
//
//   node scripts/record-fixture.mjs --api openai-completions \
//     --base-url https://openrouter.ai/api/v1 --key-env OPENROUTER_API_KEY \
//     --model openai/gpt-5.4-mini --request pedido.json --out test/fixtures/openai-completions/caso.sse
//
// Argumentos:
//   --api, --base-url, --key-env, --model, --request, --out   obrigatórios
//   --operation <op>   chat (padrão), embeddings, transcription, speech, image-generation, decision
//   --provider <nome>  nome da conta nas mensagens de erro (padrão: record)
//   --binary           grava o corpo como bytes crus, sem limpeza (respostas de áudio ou imagem)
//
// `pedido.json` é o pedido da operação (um ChatRequest, num embed, num transcribe…) e pode
// trazer `"compat"` para a conta. Em `transcription`, `audioFile` é um caminho relativo ao
// próprio pedido.json: os bytes viram `audio` e, se faltar, `mime` sai da extensão.
//
// Grava:
//   <out>             corpo da resposta. Texto passa por `scrub`; com --binary, bytes crus.
//                     Com --binary e status de erro, o corpo é texto e também passa por `scrub`.
//   <out>.meta.json   status e headers selecionados (content-type, x-generation-id)
//   <out>.request.json corpo enviado; campos multipart descritos por nome, tipo e tamanho
//
// A chave e qualquer coisa com cara de chave (`sk-…`, `AIza…`, `Bearer …`) são removidas do
// que vai para o disco. Headers de requisição nunca são salvos.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { getApi, resolveCompat, OPERATIONS } from '../src/index.js';
import { scrub, selectHeaders, describeBody } from './record-fixture-lib.mjs';

/** @param {string} name */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const apiName = arg('api');
const baseUrl = arg('base-url');
const keyEnv = arg('key-env');
const modelId = arg('model');
const requestPath = arg('request');
const out = arg('out');
const operation = arg('operation') ?? 'chat';
const provider = arg('provider') ?? 'record';
const binary = process.argv.includes('--binary');
if (!apiName || !baseUrl || !keyEnv || !modelId || !requestPath || !out) {
  console.error('FALTA: use --api --base-url --key-env --model --request --out');
  process.exit(1);
}
if (!OPERATIONS.includes(/** @type {any} */ (operation))) {
  console.error(`FALTA: operação ${operation} não existe (use ${OPERATIONS.join(', ')})`);
  process.exit(1);
}
const apiKey = process.env[keyEnv];
if (!apiKey) { console.error(`FALTA: variável ${keyEnv} vazia`); process.exit(1); }
const api = getApi(apiName);
if (!api) { console.error(`FALTA: fio ${apiName} não existe`); process.exit(1); }

// `chat` usa o buildRequest do próprio fio; as demais operações, o módulo em `api.operations`
// (contrato em "Tipos novos" do plano, Fase 1). Acesso sem tipo até essa parte entrar em types.js.
/** @type {any} */
const mod = operation === 'chat' ? api : /** @type {any} */ (api).operations?.[operation];
if (!mod || typeof mod.buildRequest !== 'function') {
  console.error(`FALTA: fio ${apiName} não implementa a operação ${operation}`);
  process.exit(1);
}

const { compat: accountCompat, ...request } = JSON.parse(await readFile(requestPath, 'utf8'));
if (operation === 'transcription' && request.audioFile) {
  const audioPath = resolve(dirname(requestPath), request.audioFile);
  request.audio = new Uint8Array(await readFile(audioPath));
  request.mime ??= mimeFromExtension(extname(audioPath));
  delete request.audioFile;
}

const account = /** @type {any} */ ({ id: 'record', provider, api: apiName, baseUrl, apiKey, compat: accountCompat });
const model = /** @type {any} */ ({ id: modelId, operations: [operation], input: ['text', 'image', 'audio', 'video', 'file'], output: outputFor(operation) });
const compat = resolveCompat(account, model);
const built = mod.buildRequest({ account, model, compat, request, apiKey });

const body = built.body instanceof FormData ? built.body : JSON.stringify(built.body);
const res = await fetch(built.url, { method: 'POST', headers: { ...compat.headers, ...built.headers }, body });
const bytes = new Uint8Array(await res.arrayBuffer());
const text = new TextDecoder().decode(bytes);

// Com --binary, bytes crus; um erro vem como texto e segue pela limpeza.
const payload = binary && res.ok ? bytes : scrub(text, apiKey);
const size = typeof payload === 'string' ? text.length : bytes.length;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, payload);
await writeFile(`${out}.meta.json`, scrub(JSON.stringify({ status: res.status, headers: selectHeaders(res.headers) }, null, 2), apiKey) + '\n');
await writeFile(`${out}.request.json`, scrub(JSON.stringify(describeBody(built.body), null, 2), apiKey) + '\n');
console.log(`${res.ok ? 'OK' : `SUJO: HTTP ${res.status}`} fixture gravada em ${out} (${size} bytes)`);
// exitCode, não exit(): com o fetch aberto, process.exit derruba o Node 24 no Windows (libuv).
process.exitCode = res.ok ? 0 : 2;

/** @param {string} operation @returns {string[]} */
function outputFor(operation) {
  if (operation === 'embeddings') return ['embeddings'];
  if (operation === 'speech') return ['audio'];
  if (operation === 'image-generation') return ['image'];
  return ['text'];
}

/** @param {string} ext @returns {string | undefined} */
function mimeFromExtension(ext) {
  return ({
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.flac': 'audio/flac',
  })[ext.toLowerCase()];
}
