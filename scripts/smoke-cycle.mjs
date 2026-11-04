#!/usr/bin/env node
// ok-gateway-providers — ciclo real de tool com pensamento (plano T1.2, Task 4.3). MANUAL.
//
//   node --env-file=<arquivo com as chaves> scripts/smoke-cycle.mjs
//
// Chama com uma tool e pensamento ligado, devolve o resultado e espera a resposta final,
// com e sem devolver o raciocínio assinado. O caso "sem" mede se a assinatura é obrigatória:
// erro ali é informação, não falha. Provedor sem chave é pulado.

import { createClient } from '../src/index.js';

const tools = [{ name: 'get_weather', description: 'Temperatura atual de uma cidade', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }];
const question = { role: 'user', content: process.env.SMOKE_QUESTION || 'Qual a temperatura em Campo Grande? Use a ferramenta e depois responda em uma frase.' };

/** @param {any} client @param {any} request */
async function collect(client, request) {
  const run = client.chat(request);
  let text = '';
  /** @type {any[]} */ const toolCalls = [];
  /** @type {any[]} */ const reasoning = [];
  for await (const ev of run) {
    if (ev.type === 'text') text += ev.text;
    if (ev.type === 'tool_call') toolCalls.push(ev);
    if (ev.type === 'reasoning') reasoning.push(ev);
  }
  return { text, toolCalls, reasoning, result: await run.result };
}

/** Eventos `reasoning` → partes: o texto se acumula até a assinatura. @param {any[]} events */
function reasoningParts(events) {
  const parts = [];
  let text = '';
  for (const ev of events) {
    text += ev.text ?? '';
    if (ev.signature) { parts.push({ type: 'reasoning', text, signature: ev.signature }); text = ''; }
    if (ev.redacted) parts.push({ type: 'reasoning', text: '', redacted: ev.redacted });
  }
  return parts;
}

/** @param {string} name @param {any} client @param {any} extra */
async function cycle(name, client, extra) {
  const first = await collect(client, { messages: [question], tools, toolChoice: 'auto', ...extra });
  const call = first.toolCalls[0];
  if (!call) { console.log(`SEM TOOL ${name}: o modelo não chamou a tool. Texto: ${first.text.slice(0, 120)}`); return false; }
  const toolCalls = first.toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments, ...(c.providerData ? { providerData: c.providerData } : {}) }));
  const results = first.toolCalls.map((c) => ({ role: 'tool', toolCallId: c.id, content: '31 graus' }));
  const parts = reasoningParts(first.reasoning);
  console.log(`     ${name}: 1ª volta · ${first.reasoning.length} evento(s) de raciocínio · ${parts.length} assinado(s) · providerData: ${call.providerData ? 'sim' : 'não'}`);

  let ok = true;
  for (const [label, content, calls] of [
    ['com assinatura', [...parts, { type: 'text', text: first.text }], toolCalls],
    ['sem assinatura', first.text, toolCalls.map(({ providerData: _p, ...c }) => c)],
  ]) {
    try {
      const second = await collect(client, { messages: [question, { role: 'assistant', content, toolCalls: calls }, ...results], tools, ...extra });
      console.log(`OK   ${name} · ${label}: ${second.text.slice(0, 90).replace(/\n/g, ' ')}`);
    } catch (e) {
      const err = /** @type {any} */ (e);
      console.log(`${label === 'sem assinatura' ? 'INFO' : 'FALHOU'} ${name} · ${label}: ${err.type} ${err.status ?? ''} ${err.message.slice(0, 220)}`);
      if (label === 'com assinatura') ok = false;
    }
  }
  return ok;
}

const env = process.env;
let failed = 0;

if (env.ANTHROPIC_API_KEY) {
  const client = createClient({
    account: { id: 'a', provider: 'anthropic', api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', apiKey: env.ANTHROPIC_API_KEY },
    model: { id: process.env.SMOKE_ANTHROPIC_MODEL || 'claude-haiku-5-5', operations: ['chat'], input: ['text'], output: ['text'], compat: { thinkingByDefault: true, supportsTemperature: false } },
  });
  if (!await cycle('anthropic', client, { effort: process.env.SMOKE_EFFORT || 'low', maxTokens: 6000 })) failed++;
  // Mede o que a API faz com tool forçada e pensamento ligado.
  try {
    await collect(client, { messages: [question], tools, toolChoice: 'required', effort: 'low', maxTokens: 4000 });
    console.log('INFO anthropic · tool forçada com pensamento: aceita');
  } catch (e) {
    console.log(`INFO anthropic · tool forçada com pensamento: ${/** @type {any} */ (e).status ?? ''} ${/** @type {any} */ (e).message.slice(0, 220)}`);
  }
} else console.log('pulado: anthropic');

if (env.OPENROUTER_API_KEY) {
  const client = createClient({
    account: { id: 'o', provider: 'openrouter', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1', apiKey: env.OPENROUTER_API_KEY, compat: { usageInStream: true, reasoningFormat: 'reasoning_object' } },
    model: { id: 'anthropic/claude-haiku-5.5', operations: ['chat'], input: ['text'], output: ['text'] },
  });
  try {
    const r = await collect(client, { messages: [{ role: 'user', content: 'Responda só: ok' }], reasoning: { maxTokens: 1000 }, maxTokens: 2000 });
    console.log(`OK   openrouter · reasoning.maxTokens: ${r.text.slice(0, 40)}`);
  } catch (e) {
    console.log(`FALHOU openrouter · reasoning.maxTokens: ${/** @type {any} */ (e).status ?? ''} ${/** @type {any} */ (e).message.slice(0, 220)}`);
  }
} else console.log('pulado: openrouter');

if (env.GOOGLE_API_KEY) {
  const client = createClient({
    account: { id: 'g', provider: 'google', api: 'google-generative-ai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: env.GOOGLE_API_KEY },
    model: { id: env.SMOKE_GOOGLE_MODEL || 'gemini-3.5-flash', operations: ['chat'], input: ['text'], output: ['text'] },
  });
  try {
    if (!await cycle('google', client, { params: { generationConfig: { thinkingConfig: { includeThoughts: true } } } })) failed++;
  } catch (e) {
    const err = /** @type {any} */ (e);
    failed++;
    console.log(`FALHOU google: ${err.type} ${err.status ?? ''} ${err.message.slice(0, 220)}`);
  }
} else console.log('pulado: google');

console.log(failed ? `SUJO: ${failed} provedor(es) falharam` : 'OK ciclo');
process.exitCode = failed ? 1 : 0;
