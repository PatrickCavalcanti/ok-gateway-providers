#!/usr/bin/env node
// ok-gateway-providers — grava uma fixture a partir de uma chamada real (spec §12).
//
//   node scripts/record-fixture.mjs --api openai-completions \
//     --base-url https://openrouter.ai/api/v1 --key-env OPENROUTER_API_KEY \
//     --model openai/gpt-5.4-mini --request pedido.json --out test/fixtures/openai-completions/caso.sse
//
// `pedido.json` é um ChatRequest da lib (`{ messages, tools?, … }`) e pode trazer
// `"compat"` para a conta. Salva o corpo SSE cru em `--out` e o corpo enviado em
// `<out>.request.json`. Headers nunca são salvos; a chave e qualquer coisa com cara de
// chave (`sk-…`, `Bearer …`) são removidas do que vai para o disco.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getApi, resolveCompat } from '../src/index.js';

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
if (!apiName || !baseUrl || !keyEnv || !modelId || !requestPath || !out) {
  console.error('FALTA: use --api --base-url --key-env --model --request --out');
  process.exit(1);
}
const apiKey = process.env[keyEnv];
if (!apiKey) { console.error(`FALTA: variável ${keyEnv} vazia`); process.exit(1); }
const api = getApi(apiName);
if (!api) { console.error(`FALTA: fio ${apiName} não existe`); process.exit(1); }

const { compat: accountCompat, ...request } = JSON.parse(await readFile(requestPath, 'utf8'));
const account = /** @type {any} */ ({ id: 'record', provider: 'record', api: apiName, baseUrl, apiKey, compat: accountCompat });
const model = /** @type {any} */ ({ id: modelId, operations: ['chat'], input: ['text', 'image', 'audio', 'video', 'file'], output: ['text'] });
const compat = resolveCompat(account, model);
const built = api.buildRequest({ account, model, compat, request, apiKey });

const res = await fetch(built.url, { method: 'POST', headers: { ...compat.headers, ...built.headers }, body: JSON.stringify(built.body) });
const raw = await res.text();

/** @param {string} s */
const scrub = (s) => s
  .split(apiKey).join('<REDACTED>')
  .replace(/sk-[A-Za-z0-9_-]{10,}/g, '<REDACTED>')
  .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/g, 'Bearer <REDACTED>');

await mkdir(dirname(out), { recursive: true });
await writeFile(out, scrub(raw));
await writeFile(`${out}.request.json`, scrub(JSON.stringify(built.body, null, 2)) + '\n');
console.log(`${res.ok ? 'OK' : `SUJO: HTTP ${res.status}`} fixture gravada em ${out} (${raw.length} bytes)`);
process.exit(res.ok ? 0 : 2);
