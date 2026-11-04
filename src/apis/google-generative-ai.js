// ok-gateway-providers — fio `google-generative-ai` (spec T1.2 §5).
//
// Gemini (AI Studio): `POST {base}/models/{id}:streamGenerateContent?alt=sse`. O cliente
// (`client.js`) faz o fetch, o status HTTP, os prazos e o custo; este módulo monta o pedido e
// lê o stream. Anexo vai por `inlineData`; o que o Gemini só aceita pela Files API (URL) dá
// `unsupported`, e nada é descartado em silêncio.

import { ProviderError, errorFromStatus, unsupported } from '../errors.js';
import { assertMediaSupported } from '../attachments.js';
import { makeUsage, num } from '../usage.js';

/** @typedef {import('../types.js').ApiModule} ApiModule */
/** @typedef {import('../types.js').Message} Message */
/** @typedef {import('../types.js').Part} Part */
/** @typedef {import('../types.js').Model} Model */
/** @typedef {{ provider: string, model: string }} Ctx */
/** @typedef {{ role: string, parts: Record<string, any>[] }} GeminiContent */

export const api = /** @type {const} */ ('google-generative-ai');

/** Chaves do corpo que `params` nunca sobrescreve: o fio é dono delas. */
const PROTECTED_KEYS = new Set(['contents', 'systemInstruction', 'tools', 'cachedContent']);

/**
 * Papel do turno com `functionResponse`. A doc atual lista só `user` e `model` para `Content.role`;
 * `function` é a forma que o adapter do Gateway usa em produção. Uma constante só, para trocar num lugar.
 */
const TOOL_RESULT_ROLE = 'function';

/** Transporte que o Gemini oferece, para modelo que não declara (spec T1.2, ajuste 1). */
const DEFAULT_TRANSPORT = Object.freeze({ image: ['data-url'], audio: 'inline_data', video: 'inline_data', file: ['data-url'] });

/**
 * Monta o pedido HTTP. Lança `unsupported` / `invalid_request` antes do fetch.
 * @type {ApiModule['buildRequest']}
 */
export function buildRequest({ account, model, compat, request, apiKey }) {
  /** @type {Ctx} */
  const ctx = { provider: account.provider, model: model.id };
  const url = `${account.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`;
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': apiKey, accept: 'text/event-stream' };

  /** @type {Record<string, any>} */
  const body = { contents: toGeminiContents(request.messages, { model, provider: account.provider }) };

  const system = systemText(request.system);
  const declarations = toDeclarations(request.tools);

  if (request.cachedContent !== undefined) {
    // A API proíbe `systemInstruction` e `tools` junto de `cachedContent`: eles vivem dentro do cache.
    if (system !== undefined || declarations) {
      throw invalid('cachedContent não pode vir com system nem tools: eles já estão dentro do cache', ctx);
    }
    body.cachedContent = request.cachedContent;
  } else {
    if (system !== undefined) body.systemInstruction = { parts: [{ text: system }] };
    if (declarations) body.tools = [{ functionDeclarations: declarations }];
  }

  /** @type {Record<string, any>} */
  const generationConfig = {};
  if (request.temperature !== undefined && compat.supportsTemperature) generationConfig.temperature = request.temperature;
  if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
  if (request.responseSchema) {
    if (compat.structuredOutput !== 'response_json_schema') {
      throw unsupported(`${ctx.provider}/${ctx.model}: este modelo/conta não suporta saída estruturada neste fio (compat.structuredOutput = ${compat.structuredOutput})`, ctx);
    }
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseJsonSchema = request.responseSchema.schema;
  }

  // params: do modelo, depois da chamada (o último vence). `generationConfig` se funde com o do
  // fio em vez de trocá-lo, para `thinkingConfig` e afins não apagarem temperature e maxOutputTokens.
  for (const layer of [model.params, request.params]) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (PROTECTED_KEYS.has(k) || v === undefined) continue;
      if (k === 'generationConfig') {
        if (isPlainObject(v)) Object.assign(generationConfig, v);
        continue;
      }
      body[k] = v;
    }
  }
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

  return { url, headers, body };
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * System como um texto só, sem separador: o chamador corta o system em offsets arbitrários.
 * `undefined` quando não há texto.
 * @param {import('../types.js').System|undefined} system
 */
function systemText(system) {
  if (system === undefined || system === '') return undefined;
  const text = typeof system === 'string' ? system : system.map((b) => b.text).join('');
  return text === '' ? undefined : text;
}

/**
 * Tools no formato `functionDeclarations`. Função sem argumentos vai sem `parameters`: o Gemini
 * recusa um schema de objeto sem propriedades.
 * @param {import('../types.js').Tool[]|undefined} tools
 */
function toDeclarations(tools) {
  if (!tools?.length) return undefined;
  return tools.map((t) => {
    /** @type {Record<string, any>} */
    const decl = { name: t.name };
    if (t.description !== undefined) decl.description = t.description;
    if (!noArguments(t.parameters)) decl.parameters = t.parameters;
    return decl;
  });
}

/** @param {Record<string, any>|undefined} schema */
function noArguments(schema) {
  if (!schema) return true;
  return schema.type === 'object' && (!schema.properties || !Object.keys(schema.properties).length);
}

// ---------------------------------------------------------------------------------------
// mensagens

/**
 * Mensagens da lib → `contents` do Gemini. Exportada: quem monta `cachedContents` por fora
 * (o snapshot do histórico) converte com a mesma função que o pedido usa.
 *
 * - `assistant` vira `model`, com `functionCall` para cada tool call.
 * - `tool` vira `functionResponse`; o `name` vem da chamada anterior de mesmo `toolCallId`.
 *   Resultados seguidos viram um turno só, como o Gemini pede para chamadas paralelas.
 * - A conversão olha só as mensagens que recebe: resultado de tool cuja chamada ficou fora da
 *   lista dá `invalid_request`.
 * @param {Message[]} messages
 * @param {{ model: Model, provider?: string }} ctx
 * @returns {GeminiContent[]}
 */
export function toGeminiContents(messages, { model, provider }) {
  /** @type {Ctx} */
  const ctx = { provider: provider ?? 'google', model: model.id };
  if (!Array.isArray(messages)) throw invalid('messages precisa ser uma lista', ctx);
  const withDefaults = /** @type {Model} */ ({ ...model, transport: { ...DEFAULT_TRANSPORT, ...model.transport } });

  /** id da chamada → nome. Os ids sintéticos se repetem a cada resposta: a mais recente vence. */
  const callNames = new Map();
  /** @type {GeminiContent[]} */
  const out = [];

  messages.forEach((msg, i) => {
    const where = `messages[${i}]`;
    if (!msg || typeof msg !== 'object') throw invalid(`${where}: mensagem malformada (esperado um objeto)`, ctx);

    if (msg.role === 'user') {
      out.push({ role: 'user', parts: userParts(msg.content, withDefaults, ctx, where) });
    } else if (msg.role === 'assistant') {
      /** @type {Record<string, any>[]} */
      const parts = [];
      const text = textOnly(msg.content, 'assistant', ctx, where);
      if (text) parts.push({ text });
      const calls = msg.toolCalls ?? [];
      if (!Array.isArray(calls)) throw invalid(`${where}: toolCalls precisa ser uma lista`, ctx);
      calls.forEach((call, k) => {
        const at = `${where}.toolCalls[${k}]`;
        if (!call || typeof call !== 'object') throw invalid(`${at}: tool_call malformado (esperado um objeto)`, ctx);
        if (typeof call.name !== 'string' || !call.name) throw invalid(`${at}: tool_call precisa de name`, ctx);
        parts.push({ functionCall: { name: call.name, args: parseArguments(call, at, ctx) } });
        if (call.id) callNames.set(call.id, call.name);
      });
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] });
    } else if (msg.role === 'tool') {
      if (!msg.toolCallId) throw invalid(`${where}: mensagem tool precisa de toolCallId`, ctx);
      const name = callNames.get(msg.toolCallId);
      if (!name) throw invalid(`${where}: resultado de tool "${msg.toolCallId}" sem chamada correspondente nas mensagens anteriores`, ctx);
      const part = { functionResponse: { name, response: { content: textOnly(msg.content, 'tool', ctx, where) } } };
      const last = out[out.length - 1];
      if (last?.role === TOOL_RESULT_ROLE) last.parts.push(part);
      else out.push({ role: TOOL_RESULT_ROLE, parts: [part] });
    } else {
      throw invalid(`${where}: papel "${/** @type {any} */ (msg).role}" não suportado (use user, assistant ou tool)`, ctx);
    }
  });
  return out;
}

/** @param {{ id?: string, name: string, arguments: string }} call @param {string} at @param {Ctx} ctx */
function parseArguments(call, at, ctx) {
  const raw = call.arguments;
  if (raw === undefined || raw === null || String(raw).trim() === '') return {};
  try {
    const parsed = JSON.parse(String(raw));
    if (!isPlainObject(parsed)) throw new Error('não é um objeto');
    return parsed;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw invalid(`${at}: arguments do tool_call "${call.name}" não é um objeto JSON válido — ${why}`, ctx);
  }
}

/**
 * Partes do papel user. Texto vazio some quando há outra parte; sozinho, vira `{ text: '' }`.
 * @param {string | Part[]} content @param {Model} model @param {Ctx} ctx @param {string} where
 * @returns {Record<string, any>[]}
 */
function userParts(content, model, ctx, where) {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) throw invalid(`${where}: content precisa ser string ou lista de partes`, ctx);
  /** @type {Record<string, any>[]} */
  const parts = [];
  content.forEach((part, j) => {
    const at = `${where}.content[${j}]`;
    if (!part || typeof part !== 'object') throw invalid(`${at}: parte malformada (esperado um objeto)`, ctx);
    if (part.type === 'text') {
      if (part.text) parts.push({ text: part.text });
      return;
    }
    if (part.type !== 'image' && part.type !== 'audio' && part.type !== 'video' && part.type !== 'file') {
      throw invalid(`${at}: tipo de parte "${/** @type {any} */ (part).type}" desconhecido`, ctx);
    }
    assertMediaSupported(part, model, { provider: ctx.provider });
    parts.push({ inlineData: inlineData(part, ctx, at) });
  });
  return parts.length ? parts : [{ text: '' }];
}

/**
 * `inlineData` de uma parte de mídia, sem o prefixo `data:…;base64,`. URL só existe via Files
 * API, que a lib não usa: dá `unsupported`.
 * @param {Extract<Part, { type: 'image'|'audio'|'video'|'file' }>} part @param {Ctx} ctx @param {string} at
 */
function inlineData(part, ctx, at) {
  const raw = part.data;
  if (raw === undefined) {
    throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: o Gemini só lê ${part.type} por inlineData (base64) ou pela Files API; baixe a URL e envie o conteúdo`, ctx);
  }
  let data = raw;
  /** @type {string|undefined} */
  let mime;
  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',');
    const header = comma === -1 ? '' : raw.slice(5, comma).split(';');
    if (comma === -1 || !header.includes('base64')) throw invalid(`${at}: data-url de ${part.type} precisa ser base64`, ctx);
    data = raw.slice(comma + 1);
    mime = header[0];
  }
  mime ||= part.type === 'audio' ? `audio/${part.format}` : part.mime;
  mime = mime?.split(';')[0].trim();
  if (!mime) throw invalid(`${at}: ${part.type} em base64 precisa de mime`, ctx);
  return { mimeType: mime, data };
}

/**
 * Papéis assistant e tool levam texto; mídia ali não tem formato neste fio.
 * @param {string | Part[]} content @param {string} role @param {Ctx} ctx @param {string} where
 */
function textOnly(content, role, ctx, where) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw invalid(`${where}: content do papel ${role} precisa ser string ou lista de partes`, ctx);
  let text = '';
  for (const p of content) {
    if (!p || p.type !== 'text') {
      throw unsupported(`${ctx.provider}/${ctx.model}: ${where}: parte ${p?.type} no papel ${role} não é suportada (mídia só em mensagens user)`, ctx);
    }
    text += p.text;
  }
  return text;
}

/** @param {string} message @param {Ctx} ctx */
function invalid(message, ctx) {
  return new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, message: `${ctx.provider}/${ctx.model}: ${message}` });
}

// ---------------------------------------------------------------------------------------
// stream

/** Status HTTP de um `error.status` textual do Google, para o erro que chega sem `code` numérico. */
const STATUS_BY_NAME = Object.freeze({
  INVALID_ARGUMENT: 400, FAILED_PRECONDITION: 400, OUT_OF_RANGE: 400, UNAUTHENTICATED: 401, PERMISSION_DENIED: 403,
  NOT_FOUND: 404, ABORTED: 409, RESOURCE_EXHAUSTED: 429, INTERNAL: 500, UNIMPLEMENTED: 501, UNAVAILABLE: 503, DEADLINE_EXCEEDED: 504,
});

/** @param {any} error @returns {number} */
function statusOfError(error) {
  const n = typeof error?.code === 'string' ? Number(error.code) : error?.code;
  if (typeof n === 'number' && Number.isInteger(n) && n >= 100 && n <= 599) return n;
  return /** @type {Record<string, number>} */ (STATUS_BY_NAME)[error?.status] ?? 500;
}

/**
 * `finishReason` do Gemini → vocabulário da lib. `STOP` com tool call na resposta é `tool_calls`.
 * O que não conhecemos passa em minúsculas.
 * @param {string} reason @param {boolean} sawCall
 */
function mapFinishReason(reason, sawCall) {
  if (reason === 'STOP') return sawCall ? 'tool_calls' : 'stop';
  if (reason === 'MAX_TOKENS') return 'length';
  if (reason === 'SAFETY' || reason === 'RECITATION') return 'content_filter';
  return reason.toLowerCase();
}

/**
 * `usageMetadata` → Usage. `promptTokenCount` inclui o cache lido; `candidatesTokenCount` não
 * inclui o pensamento, que é cobrado como saída.
 * @param {any} u @returns {import('../types.js').Usage}
 */
function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return makeUsage();
  const cacheRead = num(u.cachedContentTokenCount);
  const thoughts = num(u.thoughtsTokenCount);
  return makeUsage({
    input: Math.max(0, num(u.promptTokenCount) - cacheRead),
    output: num(u.candidatesTokenCount) + thoughts,
    cacheRead,
    ...(typeof u.thoughtsTokenCount === 'number' && Number.isFinite(u.thoughtsTokenCount) ? { reasoning: u.thoughtsTokenCount } : {}),
    raw: u,
  });
}

/**
 * Lê o SSE de `streamGenerateContent`. O Gemini não manda `[DONE]`: o fim limpo é um
 * `finishReason` (ou um prompt bloqueado); stream sem isso foi cortado e dá `upstream`.
 * @type {ApiModule['parseStream']}
 */
export async function* parseStream(events, { account, model }) {
  /** @type {Ctx} */
  const ctx = { provider: account?.provider, model: model.id };
  /** @type {string|null} */ let finishReason = null;
  /** @type {any} */ let lastUsage = null;
  let blocked = false;
  let sawCall = false;
  let emitted = false;
  let callIndex = 0;

  for await (const ev of events) {
    const data = ev.data.trim();
    if (!data) continue;

    /** @type {any} */ let chunk;
    try { chunk = JSON.parse(data); } catch (cause) {
      throw new ProviderError({ type: 'upstream', ...ctx, body: data, cause, message: `${ctx.provider}/${ctx.model}: chunk do stream não é JSON` });
    }

    if (chunk?.error) {
      throw errorFromStatus(statusOfError(chunk.error), {
        ...ctx, body: chunk, emitted,
        message: typeof chunk.error === 'string' ? chunk.error : chunk.error.message,
      });
    }

    // Cumulativo: o último chunk com `usageMetadata` traz o valor final.
    if (chunk?.usageMetadata && typeof chunk.usageMetadata === 'object') lastUsage = chunk.usageMetadata;
    if (chunk?.promptFeedback?.blockReason && !chunk.candidates?.length) blocked = true;

    const candidate = chunk?.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part.text === 'string') {
        if (!part.text) continue;
        emitted = true;
        yield part.thought === true ? { type: 'reasoning', text: part.text } : { type: 'text', text: part.text };
      } else if (part.functionCall) {
        if (typeof part.functionCall.name !== 'string' || !part.functionCall.name) {
          throw new ProviderError({ type: 'upstream', ...ctx, body: data, message: `${ctx.provider}/${ctx.model}: functionCall sem nome no stream` });
        }
        // O Gemini não manda id: sintetizamos um por resposta, que o chamador devolve no papel tool.
        sawCall = true;
        emitted = true;
        yield { type: 'tool_call', id: `gemini-tc-${callIndex++}`, name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) };
      }
      // Outras partes (código executável, imagem de saída…) não têm evento: são ignoradas.
    }

    const reason = candidate?.finishReason;
    if (typeof reason === 'string' && reason && reason !== 'FINISH_REASON_UNSPECIFIED') finishReason = reason;
  }

  if (!finishReason && !blocked) {
    throw new ProviderError({ type: 'upstream', ...ctx, message: `${ctx.provider}/${ctx.model}: stream terminou sem finishReason (resposta cortada)` });
  }
  return {
    finishReason: finishReason ? mapFinishReason(finishReason, sawCall) : 'content_filter',
    usage: normalizeUsage(lastUsage),
    reportedCostUsd: null,
  };
}
