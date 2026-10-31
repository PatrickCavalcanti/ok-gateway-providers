// ok-gateway-providers — fio `openai-completions` (spec §11).
//
// Chat Completions em SSE: OpenAI, OpenRouter, Groq, Ollama (/v1), Inception, DeepSeek,
// llama.cpp e o Gateway. O cliente (`client.js`) faz o fetch, o status HTTP, os prazos e o
// custo; este módulo só monta o pedido e lê o stream. Cada diferença entre provedores é um
// campo do compat — não há `if` por provedor aqui.

import { ProviderError, errorFromStatus, unsupported } from '../errors.js';
import { toOpenAIContent } from '../attachments.js';

/** @typedef {import('../types.js').ApiModule} ApiModule */
/** @typedef {import('../types.js').Message} Message */
/** @typedef {import('../types.js').Part} Part */
/** @typedef {import('../types.js').Usage} Usage */

export const api = /** @type {const} */ ('openai-completions');

/** Chaves que `params` nunca sobrescreve: o fio é dono delas. */
const PROTECTED_KEYS = new Set(['model', 'messages', 'stream', 'tools', 'response_format', 'stream_options']);

/**
 * Monta o pedido HTTP. Puro, exceto pela validação de anexos, que lança `unsupported`.
 * @type {ApiModule['buildRequest']}
 */
export function buildRequest({ account, model, compat, request, apiKey }) {
  const ctx = { provider: account.provider, model: model.id };
  const url = `${account.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  /** @type {Record<string, unknown>} */
  const body = {
    model: model.id,
    messages: buildMessages(request, { model, compat, provider: account.provider }),
    stream: true,
  };

  if (request.tools?.length) {
    body.tools = request.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        ...(t.description !== undefined ? { description: t.description } : {}),
        parameters: t.parameters,
      },
    }));
  }

  if (request.responseSchema) {
    const { name, schema, strict } = request.responseSchema;
    switch (compat.structuredOutput) {
      case 'response_format':
        body.response_format = { type: 'json_schema', json_schema: { name: name ?? 'response', strict: strict ?? true, schema } };
        break;
      case 'top_level_json_schema': // extensão do llama.cpp: o schema solto no topo do corpo
        body.json_schema = schema;
        break;
      default:
        // 'none' (ou um valor que não existe neste fio): não dá para afirmar que o endpoint
        // aplica o schema, e ignorar entregaria texto livre a quem pediu JSON.
        throw unsupported(`${ctx.provider}/${ctx.model}: este modelo/conta não suporta saída estruturada (compat.structuredOutput = ${compat.structuredOutput})`, ctx);
    }
  }

  // Esforço de raciocínio. Com reasoningFormat 'none' o modelo/endpoint não tem o
  // parâmetro: o esforço é dica de custo/latência, não mídia — é ignorado SEM erro.
  if (request.effort !== undefined) {
    switch (compat.reasoningFormat) {
      case 'reasoning_effort': body.reasoning_effort = request.effort; break;
      case 'reasoning_object': body.reasoning = { effort: request.effort }; break;
      case 'none': break;
      default:
        throw unsupported(`${ctx.provider}/${ctx.model}: reasoningFormat "${compat.reasoningFormat}" não existe no fio openai-completions`, ctx);
    }
  }

  if (compat.usageInStream) body.stream_options = { include_usage: true };

  const maxTokens = request.maxTokens ?? model.maxTokens;
  if (maxTokens !== undefined) body[compat.maxTokensField] = maxTokens;

  // Modelo que não aceita temperature (ex.: raciocínio puro): omite, é só amostragem.
  if (request.temperature !== undefined && compat.supportsTemperature) body.temperature = request.temperature;
  if (compat.supportsStore) body.store = false;

  // params: do modelo, depois da chamada (o último vence). Nunca sobrescrevem o que é do
  // fio (PROTECTED_KEYS); descartar uma chave protegida é deliberado e não gera erro.
  // `provider` (roteamento do OpenRouter) só passa com compat.providerRouting.
  for (const layer of [model.params, request.params]) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (PROTECTED_KEYS.has(k) || (k === 'provider' && !compat.providerRouting)) continue;
      body[k] = v;
    }
  }

  return { url, headers, body };
}

/**
 * @param {import('../types.js').ChatRequest} request
 * @param {{ model: import('../types.js').Model, compat: import('../types.js').ResolvedCompat, provider: string }} ctx
 */
function buildMessages(request, ctx) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  const sys = systemContent(request.system, ctx.compat);
  if (sys !== null) out.push({ role: ctx.compat.supportsDeveloperRole ? 'developer' : 'system', content: sys });

  for (const msg of request.messages) {
    if (msg.role === 'user') {
      out.push({ role: 'user', content: userContent(msg.content, ctx) });
    } else if (msg.role === 'assistant') {
      /** @type {Record<string, unknown>} */
      const m = { role: 'assistant', content: textOnly(msg.content, 'assistant', ctx) };
      if (msg.toolCalls?.length) {
        m.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments || '{}' },
        }));
      }
      out.push(m);
    } else if (msg.role === 'tool') {
      if (!msg.toolCallId) throw badRequest(ctx, 'mensagem tool sem toolCallId');
      out.push({ role: 'tool', tool_call_id: msg.toolCallId, content: textOnly(msg.content, 'tool', ctx) });
    } else {
      throw badRequest(ctx, `papel de mensagem desconhecido: ${String(/** @type {any} */ (msg).role)}`);
    }
  }
  return out;
}

/**
 * System como string, ou como partes quando alguma tem marca de cache e o compat a aceita.
 * Sem `cacheMarker: 'cache_control'` a marca é só uma dica de custo e não vai no corpo.
 * @param {import('../types.js').System|undefined} system
 * @param {import('../types.js').ResolvedCompat} compat
 * @returns {string | Record<string, unknown>[] | null}
 */
function systemContent(system, compat) {
  if (system === undefined || system === '') return null;
  if (typeof system === 'string') return system;
  if (!system.length) return null;
  if (compat.cacheMarker === 'cache_control' && system.some((b) => b.cache)) {
    return system.map((b) => {
      /** @type {Record<string, unknown>} */
      const part = { type: 'text', text: b.text };
      if (b.cache) part.cache_control = b.cache.ttl ? { type: 'ephemeral', ttl: b.cache.ttl } : { type: 'ephemeral' };
      return part;
    });
  }
  return system.map((b) => b.text).join('\n\n');
}

/**
 * @param {string | Part[]} content
 * @param {{ model: import('../types.js').Model, compat: import('../types.js').ResolvedCompat, provider: string }} ctx
 */
function userContent(content, ctx) {
  if (typeof content === 'string') return content;
  return toOpenAIContent(content, ctx);
}

/**
 * Papéis assistant e tool levam texto: mídia ali não tem formato neste fio.
 * @param {string | Part[]} content @param {string} role @param {{ model: import('../types.js').Model, provider: string }} ctx
 */
function textOnly(content, role, ctx) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw badRequest(ctx, `content do papel ${role} precisa ser string ou lista de partes`);
  let text = '';
  for (const p of content) {
    if (p.type !== 'text') {
      throw unsupported(`${ctx.provider}/${ctx.model.id}: parte ${p.type} no papel ${role} não é suportada (mídia só em mensagens user)`, { provider: ctx.provider, model: ctx.model.id });
    }
    text += p.text;
  }
  return text;
}

/** @param {{ model: { id: string }, provider: string }} ctx @param {string} message */
function badRequest(ctx, message) {
  return new ProviderError({ type: 'invalid_request', retryOther: false, provider: ctx.provider, model: ctx.model.id, message: `${ctx.provider}/${ctx.model.id}: ${message}` });
}

// ---------------------------------------------------------------------------------------
// stream

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * `usage` do chunk → Usage normalizado. `input` sai sem o cache lido nem gravado.
 * @param {any} u
 * @returns {Usage}
 */
export function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, raw: null };
  const cacheRead = num(u.prompt_tokens_details?.cached_tokens);
  const cacheWrite = num(u.prompt_tokens_details?.cache_write_tokens);
  /** @type {Usage} */
  const usage = {
    input: Math.max(0, num(u.prompt_tokens) - cacheRead - cacheWrite),
    output: num(u.completion_tokens),
    cacheRead,
    cacheWrite,
    cacheWrite1h: 0,
    raw: u,
  };
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  if (typeof reasoning === 'number' && Number.isFinite(reasoning)) usage.reasoning = reasoning;
  return usage;
}

/** @param {unknown} reason @returns {string|null} */
function mapFinishReason(reason) {
  if (typeof reason !== 'string' || !reason) return null;
  if (reason === 'function_call') return 'tool_calls'; // grafia antiga da OpenAI
  return reason; // stop, length, tool_calls, content_filter e o que vier de novo passam como vieram
}

/** @param {unknown} code @returns {number} */
function statusOf(code) {
  const n = typeof code === 'string' ? Number(code) : code;
  return typeof n === 'number' && Number.isInteger(n) && n >= 100 && n <= 599 ? n : 500;
}

/**
 * Lê os eventos SSE e rende text/reasoning/tool_call; devolve o resumo no `return`.
 * `reasoning_details` (OpenRouter) não é lido: `reasoning`/`reasoning_content` já trazem o texto.
 * @type {ApiModule['parseStream']}
 */
export async function* parseStream(events, { account, model }) {
  const ctx = { provider: account?.provider, model: model.id };
  /** @type {Map<number, { id: string, name: string, args: string }>} */
  const calls = new Map();
  /** @type {string|null} */ let finishReason = null;
  /** @type {any} */ let lastUsage = null;
  let done = false;

  function* flushCalls() {
    for (const [index, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      if (!c.name) {
        throw new ProviderError({ type: 'upstream', ...ctx, message: `${ctx.provider}/${ctx.model}: tool_call sem nome no stream (índice ${index})` });
      }
      // Provedor que não manda id: o do índice basta, o cliente devolve o mesmo no papel tool.
      yield /** @type {const} */ ({ type: 'tool_call', id: c.id || `call_${index}`, name: c.name, arguments: c.args || '{}' });
    }
    calls.clear();
  }

  for await (const ev of events) {
    const data = ev.data.trim();
    if (data === '[DONE]') { done = true; break; }
    if (!data) continue;

    /** @type {any} */ let chunk;
    try { chunk = JSON.parse(data); } catch (cause) {
      throw new ProviderError({ type: 'upstream', ...ctx, body: data, cause, message: `${ctx.provider}/${ctx.model}: chunk do stream não é JSON` });
    }
    if (ev.event === 'error' && !chunk?.error) chunk = { error: chunk };
    if (chunk?.error) {
      const e = chunk.error;
      throw errorFromStatus(statusOf(typeof e === 'object' ? e?.code ?? e?.status : undefined), {
        ...ctx, body: chunk, message: typeof e === 'string' ? e : e?.message,
      });
    }

    if (chunk.usage && typeof chunk.usage === 'object') lastUsage = chunk.usage;

    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if (delta) {
      if (typeof delta.content === 'string' && delta.content) yield { type: 'text', text: delta.content };
      const reasoning = delta.reasoning ?? delta.reasoning_content;
      if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning };
      for (const tc of delta.tool_calls ?? []) accumulate(calls, tc);
    }
    const reason = mapFinishReason(choice?.finish_reason);
    if (reason) {
      finishReason = reason;
      yield* flushCalls(); // o usage, se vier, chega em chunk posterior
    }
  }

  yield* flushCalls();
  if (!finishReason) {
    // Sem finish_reason e sem [DONE] o stream foi cortado: não fingir um fim limpo.
    if (!done) throw new ProviderError({ type: 'upstream', ...ctx, message: `${ctx.provider}/${ctx.model}: stream terminou sem finish_reason nem [DONE]` });
    finishReason = 'stop';
  }
  return {
    finishReason,
    usage: normalizeUsage(lastUsage),
    reportedCostUsd: typeof lastUsage?.cost === 'number' ? lastUsage.cost : null,
  };
}

/**
 * Soma um fragmento de tool_call: id/nome vêm no primeiro, `arguments` se concatena.
 * Sem `index` (alguns compatíveis mandam a chamada inteira de uma vez): `id` novo abre
 * uma chamada, fragmento sem id continua a última.
 * @param {Map<number, { id: string, name: string, args: string }>} calls @param {any} tc
 */
function accumulate(calls, tc) {
  let index = tc.index;
  if (typeof index !== 'number') {
    const known = tc.id ? [...calls.entries()].find(([, c]) => c.id === tc.id) : undefined;
    index = known ? known[0] : tc.id ? calls.size : Math.max(calls.size - 1, 0);
  }
  let c = calls.get(index);
  if (!c) { c = { id: '', name: '', args: '' }; calls.set(index, c); }
  if (tc.id && !c.id) c.id = tc.id;
  if (tc.function?.name && !c.name) c.name = tc.function.name;
  if (typeof tc.function?.arguments === 'string') c.args += tc.function.arguments;
}
