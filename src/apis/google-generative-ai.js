// ok-gateway-providers — fio `google-generative-ai` (spec T1.2 §5).
//
// Gemini (AI Studio): `POST {base}/models/{id}:streamGenerateContent?alt=sse`. O cliente
// (`client.js`) faz o fetch, o status HTTP, os prazos e o custo; este módulo monta o pedido e
// lê o stream. Anexo vai por `inlineData`; o que o Gemini só aceita pela Files API (URL) dá
// `unsupported`, e nada é descartado em silêncio.

import { ProviderError, errorFromStatus, unsupported } from '../errors.js';
import { assertMediaSupported, parseDataUrl } from '../attachments.js';
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

  // O Gemini não tem orçamento de raciocínio neste pedido (o orçamento vive em params.generationConfig.thinkingConfig).
  if (request.reasoning && (request.reasoning.maxTokens !== undefined || request.reasoning.exclude !== undefined)) {
    throw unsupported(`${ctx.provider}/${ctx.model}: reasoning.maxTokens/exclude só existem com reasoningFormat "reasoning_object" (para o Gemini use params.generationConfig.thinkingConfig)`, ctx);
  }

  const system = systemText(request.system);
  const declarations = toDeclarations(request.tools);
  const choice = toolChoiceOf(request, ctx);
  const stop = stopOf(request, ctx);

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
        if (!isPlainObject(v)) throw invalid('params.generationConfig precisa ser um objeto', ctx);
        Object.assign(generationConfig, v);
        continue;
      }
      body[k] = v;
    }
  }
  // `toolChoice` e `stop` explícitos vencem `params`.
  if (choice !== undefined && request.cachedContent === undefined) body.toolConfig = { functionCallingConfig: functionCallingConfig(choice) };
  if (stop) generationConfig.stopSequences = stop;
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

  return { url, headers, body };
}

/**
 * `toolChoice` → `functionCallingConfig`. `required` e a tool nomeada são ambos o modo `ANY`; a nomeada
 * restringe as funções permitidas a uma.
 * @param {import('../types.js').ToolChoice} choice
 */
function functionCallingConfig(choice) {
  if (typeof choice === 'object') return { mode: 'ANY', allowedFunctionNames: [choice.name] };
  return { mode: { auto: 'AUTO', none: 'NONE', required: 'ANY' }[choice] };
}

/**
 * `toolChoice` do pedido, conferido. Sem `tools` não há o que escolher: `invalid_request`, sem outro alvo.
 * Com `cachedContent` as tools vivem no cache e `toolConfig` é proibido junto, então cai no mesmo erro.
 * @param {import('../types.js').ChatRequest} request @param {Ctx} ctx
 * @returns {import('../types.js').ToolChoice | undefined}
 */
function toolChoiceOf(request, ctx) {
  const choice = request.toolChoice;
  if (choice === undefined) return undefined;
  if (!request.tools?.length) {
    throw invalid(request.cachedContent !== undefined
      ? 'toolChoice não pode vir com cachedContent: as tools vivem dentro do cache e a API proíbe toolConfig junto'
      : 'toolChoice exige tools no pedido', ctx);
  }
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice;
  if (choice && typeof choice === 'object' && typeof choice.name === 'string' && choice.name) return choice;
  throw invalid('toolChoice precisa ser "auto", "none", "required" ou { name }', ctx);
}

/**
 * `stop` do pedido, conferido. Lista vazia é o mesmo que não pedir.
 * @param {import('../types.js').ChatRequest} request @param {Ctx} ctx @returns {string[] | undefined}
 */
function stopOf(request, ctx) {
  const stop = request.stop;
  if (stop === undefined) return undefined;
  if (!Array.isArray(stop) || stop.some((s) => typeof s !== 'string')) throw invalid('stop precisa ser uma lista de textos', ctx);
  return stop.length ? stop : undefined;
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

/** Chaves que um objeto sem argumentos pode ter: nenhuma delas restringe o que a função recebe. */
const EMPTY_SCHEMA_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties', '$schema']);

/**
 * Objeto que não declara nada que restrinja: sem `properties` nem `required` (ausentes ou vazios) e
 * sem chave fora de `EMPTY_SCHEMA_KEYS`. O Gemini recusa objeto sem propriedades. `$defs`, `oneOf`
 * e o resto mantêm o schema; `additionalProperties` como schema (mapa com valor tipado) também.
 * @param {Record<string, any>|undefined} schema
 */
function noArguments(schema) {
  if (!schema) return true;
  if (schema.type !== 'object') return false;
  if (Object.keys(schema).some((k) => !EMPTY_SCHEMA_KEYS.has(k))) return false;
  if (isPlainObject(schema.additionalProperties)) return false;
  return !Object.keys(schema.properties ?? {}).length && !(schema.required ?? []).length;
}

// ---------------------------------------------------------------------------------------
// mensagens

/**
 * Mensagens da lib → `contents` do Gemini. Exportada: quem monta `cachedContents` por fora
 * (o snapshot do histórico) converte com a mesma função que o pedido usa.
 *
 * - `assistant` vira `model`, com `functionCall` para cada tool call.
 * - `tool` vira `functionResponse`; o `name` vem de `toolName` ou da chamada anterior de mesmo `toolCallId`.
 *   Resultados seguidos viram um turno só, como o Gemini pede para chamadas paralelas.
 * - A conversão olha só as mensagens que recebe: resultado de tool cuja chamada ficou fora da
 *   lista e sem `toolName` dá `invalid_request`.
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
      // Raciocínio de outro provedor (ou assinado pela Anthropic) não volta ao Gemini: ele é ignorado.
      const text = textOnly(msg.content, 'assistant', ctx, where, true);
      if (text) parts.push({ text });
      const calls = msg.toolCalls ?? [];
      if (!Array.isArray(calls)) throw invalid(`${where}: toolCalls precisa ser uma lista`, ctx);
      calls.forEach((call, k) => {
        const at = `${where}.toolCalls[${k}]`;
        if (!call || typeof call !== 'object') throw invalid(`${at}: tool_call malformado (esperado um objeto)`, ctx);
        if (typeof call.name !== 'string' || !call.name) throw invalid(`${at}: tool_call precisa de name`, ctx);
        // A assinatura de pensamento fica ao lado do functionCall, como a API a entregou.
        const signature = call.providerData?.thoughtSignature;
        parts.push({
          functionCall: { name: call.name, args: parseArguments(call, at, ctx) },
          ...(typeof signature === 'string' && signature ? { thoughtSignature: signature } : {}),
        });
        if (call.id) callNames.set(call.id, call.name);
      });
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] });
    } else if (msg.role === 'tool') {
      // O nome da mensagem vence: é o único caminho quando a chamada ficou fora da lista (prefixo em cache).
      if (msg.toolName !== undefined && (typeof msg.toolName !== 'string' || !msg.toolName.trim())) {
        throw invalid(`${where}: toolName precisa ser um texto não vazio`, ctx);
      }
      const name = msg.toolName || (msg.toolCallId ? callNames.get(msg.toolCallId) : undefined);
      if (!name) {
        throw invalid(msg.toolCallId
          ? `${where}: resultado de tool "${msg.toolCallId}" sem chamada correspondente nas mensagens anteriores nem toolName`
          : `${where}: mensagem tool precisa de toolCallId ou toolName`, ctx);
      }
      // Sem campo de erro próprio: o Gemini lê `response.error` como falha da função.
      const text = textOnly(msg.content, 'tool', ctx, where);
      const part = { functionResponse: { name, response: msg.isError === true ? { error: text } : { content: text } } };
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
  const url = parseDataUrl(raw);
  if (url) {
    if (!url.base64) throw invalid(`${at}: data-url de ${part.type} precisa ser base64`, ctx);
    data = url.data;
    mime = url.mime;
  }
  // `format`/`mime` explícitos vencem o prefixo do data-url, como no openai-completions.
  mime = (part.type === 'audio' ? (part.format ? `audio/${part.format}` : undefined) : part.mime) || mime;
  mime = mime?.split(';')[0].trim();
  if (!mime) throw invalid(`${at}: ${part.type} em base64 precisa de mime`, ctx);
  return { mimeType: mime, data };
}

/**
 * Papéis assistant e tool levam texto; mídia ali não tem formato neste fio. `skipReasoning` descarta as
 * partes reasoning (só o papel assistant as tem).
 * @param {string | Part[]} content @param {string} role @param {Ctx} ctx @param {string} where @param {boolean} [skipReasoning]
 */
function textOnly(content, role, ctx, where, skipReasoning = false) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw invalid(`${where}: content do papel ${role} precisa ser string ou lista de partes`, ctx);
  let text = '';
  for (const p of content) {
    if (skipReasoning && p?.type === 'reasoning') continue;
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
    ...(thoughts ? { reasoning: thoughts } : {}),
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
  /** @type {string|null} primeira parte que o fio não modela */
  let unknownPart = null;

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
        // `thoughtSignature` vem na mesma parte da chamada e precisa voltar nela: sai como dado opaco do provedor.
        const signature = typeof part.thoughtSignature === 'string' && part.thoughtSignature ? part.thoughtSignature : null;
        yield {
          type: 'tool_call', id: `gemini-tc-${callIndex++}`, name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}),
          ...(signature ? { providerData: { thoughtSignature: signature } } : {}),
        };
      } else {
        // Código executável, imagem de saída…: sem evento. Só vira erro se a resposta ficar vazia (abaixo).
        // `thoughtSignature` e `thought` sozinhos são metadado, não conteúdo.
        unknownPart ??= Object.keys(part ?? {}).find((k) => k !== 'thoughtSignature' && k !== 'thought') ?? null;
      }
    }

    const reason = candidate?.finishReason;
    if (typeof reason === 'string' && reason && reason !== 'FINISH_REASON_UNSPECIFIED') finishReason = reason;
  }

  if (!finishReason && !blocked) {
    throw new ProviderError({ type: 'upstream', ...ctx, message: `${ctx.provider}/${ctx.model}: stream terminou sem finishReason (resposta cortada)` });
  }
  const reason = finishReason ? mapFinishReason(finishReason, sawCall) : 'content_filter';
  // Um fim normal sem nada emitido e com parte desconhecida seria uma resposta vazia fingindo sucesso.
  if (unknownPart && !emitted && reason !== 'content_filter') {
    throw unsupported(`${ctx.provider}/${ctx.model}: a resposta veio só com a parte "${unknownPart}", que este fio não lê (texto, raciocínio e tool call são os suportados)`, ctx);
  }
  return {
    finishReason: reason,
    usage: normalizeUsage(lastUsage),
    reportedCostUsd: null,
  };
}
