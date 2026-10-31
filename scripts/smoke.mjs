#!/usr/bin/env node
// ok-gateway-providers — smoke contra provedores reais (spec §12, §14). MANUAL.
//
// Roda antes de cada tag, com as chaves do ambiente:
//   OPENROUTER_API_KEY=… ANTHROPIC_API_KEY=… node scripts/smoke.mjs
// Modelos (opcionais): SMOKE_OPENROUTER_MODEL (padrão openai/gpt-5.4-mini),
//   SMOKE_ANTHROPIC_MODEL (padrão claude-haiku-5-5).
// Provedor sem chave é pulado, e o script diz isso. Casos: texto, tool call, imagem,
// PDF e saída estruturada (caso que o modelo não declara na entrada é pulado). Exit 1 se algum caso falhar.

import { createClient, parseOpenRouterModels } from '../src/index.js';

// PNG 16×16 vermelho (base64), para o caso de imagem sem depender de rede.
const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=';

// PDF de uma página com o texto "A palavra secreta e: girassol".
const SECRET_PDF = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA2MCA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDcyIDcyMCBUZCAoQSBwYWxhdnJhIHNlY3JldGEgZTogZ2lyYXNzb2wpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzUxIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDIxCiUlRU9GCg==';

/** @type {{ name: string, account: any, model: any }[]} */
const targets = [];

if (process.env.OPENROUTER_API_KEY) {
  const id = process.env.SMOKE_OPENROUTER_MODEL || 'openai/gpt-5.4-mini';
  const res = await fetch('https://openrouter.ai/api/v1/models');
  const models = parseOpenRouterModels(await res.json());
  const model = models.find((m) => m.id === id);
  if (!model) { console.error(`FALTA: ${id} não está no catálogo do OpenRouter`); process.exit(1); }
  targets.push({
    name: 'openrouter',
    account: {
      id: 'smoke-openrouter', provider: 'openrouter', api: 'openai-completions',
      baseUrl: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY,
      compat: { usageInStream: true, headers: { 'X-Title': 'ok-gateway-providers smoke' } },
    },
    model,
  });
} else {
  console.log('pulado: openrouter (sem OPENROUTER_API_KEY)');
}

if (process.env.ANTHROPIC_API_KEY) {
  targets.push({
    name: 'anthropic',
    account: {
      id: 'smoke-anthropic', provider: 'anthropic', api: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com/v1', apiKey: process.env.ANTHROPIC_API_KEY,
    },
    model: {
      id: process.env.SMOKE_ANTHROPIC_MODEL || 'claude-haiku-5-5',
      operations: ['chat'], input: ['text', 'image', 'file'], output: ['text'],
      // A geração 5 pensa por padrão e recusa temperature.
      compat: { thinkingByDefault: true, supportsTemperature: false },
      cost: { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite1h: 0.20 },
    },
  });
} else {
  console.log('pulado: anthropic (sem ANTHROPIC_API_KEY)');
}

const cases = [
  {
    name: 'texto',
    request: { messages: [{ role: 'user', content: 'Responda só com a palavra: pronto' }], maxTokens: 2000 },
    /** @param {any} r */ check: (r) => /pronto/i.test(r.text),
  },
  {
    name: 'tool call',
    request: {
      messages: [{ role: 'user', content: 'Qual a temperatura em Campo Grande? Use a ferramenta.' }],
      tools: [{ name: 'get_weather', description: 'Temperatura atual de uma cidade', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }],
      maxTokens: 2000,
    },
    /** @param {any} r */ check: (r) => r.toolCalls.length > 0 && typeof JSON.parse(r.toolCalls[0].arguments).city === 'string',
  },
  {
    name: 'imagem',
    request: {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Qual a cor desta imagem? Uma palavra.' }, { type: 'image', data: RED_PNG, mime: 'image/png' }] }],
      maxTokens: 2000,
    },
    /** @param {any} r */ check: (r) => /vermelh|red/i.test(r.text),
    needs: 'image',
  },
  {
    name: 'pdf',
    request: {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Qual é a palavra secreta escrita neste PDF? Responda só a palavra.' }, { type: 'file', data: SECRET_PDF, mime: 'application/pdf', name: 'segredo.pdf' }] }],
      maxTokens: 2000,
    },
    /** @param {any} r */ check: (r) => /girassol/i.test(r.text),
    needs: 'file',
  },
  {
    name: 'saída estruturada',
    request: {
      messages: [{ role: 'user', content: 'Invente uma cidade fictícia e sua população.' }],
      responseSchema: { name: 'cidade', strict: true, schema: { type: 'object', properties: { nome: { type: 'string' }, populacao: { type: 'integer' } }, required: ['nome', 'populacao'], additionalProperties: false } },
      maxTokens: 2000,
    },
    /** @param {any} r */ check: (r) => { try { const o = JSON.parse(r.text); return typeof o.nome === 'string' && Number.isInteger(o.populacao); } catch { return false; } },
  },
];

let failed = 0;
for (const t of targets) {
  const client = createClient({ account: t.account, model: t.model });
  for (const c of cases) {
    if (c.needs && !t.model.input.includes(c.needs)) {
      console.log(`pulado: ${t.name} · ${c.name} (o modelo ${t.model.id} não declara ${c.needs} na entrada)`);
      continue;
    }
    const started = Date.now();
    try {
      const run = client.chat(/** @type {any} */ (c.request));
      let text = '';
      /** @type {any[]} */ const toolCalls = [];
      for await (const ev of run) {
        if (ev.type === 'text') text += ev.text;
        if (ev.type === 'tool_call') toolCalls.push(ev);
      }
      const r = await run.result;
      const ok = c.check({ text, toolCalls });
      if (!ok) failed++;
      console.log(`${ok ? 'OK  ' : 'FALHOU'} ${t.name} · ${c.name} · ${Date.now() - started} ms · in ${r.usage.input} out ${r.usage.output} · US$ ${r.cost.usd ?? '—'} (${r.cost.source})`);
      if (!ok) console.log(`       texto: ${JSON.stringify(text).slice(0, 200)} · tools: ${JSON.stringify(toolCalls).slice(0, 200)}`);
    } catch (e) {
      failed++;
      const err = /** @type {any} */ (e);
      console.log(`FALHOU ${t.name} · ${c.name} · ${err.type ?? 'erro'}: ${err.message}`);
    }
  }
}

if (!targets.length) { console.log('FALTA: nenhuma chave no ambiente — nada foi testado'); process.exit(1); }
console.log(failed ? `SUJO: ${failed} caso(s) falharam` : 'OK smoke');
process.exit(failed ? 1 : 0);
