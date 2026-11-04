// ok-gateway-providers — fio `openai-responses` (spec T1.2 §7).
//
// Responses API em SSE: `POST {base}/responses`. OpenAI e os servidores que copiam o formato
// (llama.cpp). O cliente (`client.js`) faz o fetch, o status HTTP, os prazos e o custo; este
// módulo monta o pedido e lê o stream. Diferença entre provedores é campo do compat — não há `if`
// por provedor aqui. Todo item de `input` leva `type` explícito: o llama.cpp recusa item sem tipo.

import { ProviderError, errorFromStatus, unsupported } from '../errors.js';
import { assertMediaSupported, defaultFilename, parseDataUrl } from '../attachments.js';
import { makeUsage, num, reportedCost } from '../usage.js';

/** @typedef {import('../types.js').ApiModule} ApiModule */
/** @typedef {import('../types.js').Message} Message */
/** @typedef {import('../types.js').Part} Part */
/** @typedef {import('../types.js').Model} Model */
/** @typedef {{ provider: string, model: string }} Ctx */

export const api = /** @type {const} */ ('openai-responses');

// Embeddings, áudio, imagem e decisão não mudam entre os dois fios da OpenAI.
export { operations } from './openai-completions.js';

/** Chaves do corpo que `params` nunca sobrescreve: o fio é dono delas. */
const PROTECTED_KEYS = new Set(['model', 'input', 'stream', 'tools']);

/** Chaves que `params` funde com o objeto do fio em vez de trocá-lo (`text.verbosity`, `reasoning.summary`…); o que é do fio vence. */
const MERGED_KEYS = ['text', 'reasoning'];

/** Este fio não tem campo de erro no resultado da tool: o aviso vai no texto (spec T1.2 §6). */
const TOOL_ERROR_PREFIX = 'Tool error: ';

/**
 * Monta o pedido HTTP. Lança `unsupported` / `invalid_request` antes do fetch.
 * @type {ApiModule['buildRequest']}
 */
export function buildRequest({ account, model, compat, request, apiKey }) {
  /** @type {Ctx} */
  const ctx = { provider: account.provider, model: model.id };
  if (request.cachedContent !== undefined) {
    throw unsupported(`${ctx.provider}/${ctx.model}: cachedContent só existe no fio google-generative-ai`, ctx);
  }
  const stop = stopOf(request, ctx);
  if (stop) throw unsupported(`${ctx.provider}/${ctx.model}: a Responses API não tem stop (textos que encerram a geração)`, ctx);

  const url = `${account.baseUrl.replace(/\/+$/, '')}/responses`;
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  /** @type {Record<string, any>} */
  const body = {
    model: model.id,
    input: buildInput(request, { model, provider: account.provider }),
    stream: true,
  };

  if (request.tools?.length) {
    // Formato plano: sem o envelope `function` do Chat Completions.
    body.tools = request.tools.map((t) => ({
      type: 'function',
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      parameters: t.parameters ?? { type: 'object', properties: {} },
    }));
  }

  const choice = toolChoiceOf(request, ctx);

  if (request.responseSchema && compat.structuredOutput === 'top_level_json_schema') {
    // Extensão do llama.cpp: o /v1/responses dele ignora text.format e devolve texto livre.
    body.json_schema = request.responseSchema.schema;
  } else if (request.responseSchema) {
    if (compat.structuredOutput !== 'text_format') {
      // 'none' (ou um formato de outro fio): não dá para afirmar que o endpoint aplica o schema, e
      // ignorar entregaria texto livre a quem pediu JSON.
      throw unsupported(`${ctx.provider}/${ctx.model}: este modelo/conta não suporta saída estruturada neste fio (compat.structuredOutput = ${compat.structuredOutput}; use "text_format")`, ctx);
    }
    const { name, schema, strict } = request.responseSchema;
    body.text = { format: { type: 'json_schema', name: name ?? 'response', strict: strict ?? true, schema } };
  }

  // Orçamento (`reasoning.maxTokens`/`exclude`) não existe na Responses API, qualquer que seja o formato.
  // Esforço com reasoningFormat 'none' é dica de custo/latência e é ignorado sem erro.
  const budget = request.reasoning;
  if (budget && (budget.maxTokens !== undefined || budget.exclude !== undefined)) {
    throw unsupported(`${ctx.provider}/${ctx.model}: reasoning.maxTokens/exclude não existem na Responses API; use effort`, ctx);
  }
  if (request.effort !== undefined) {
    switch (compat.reasoningFormat) {
      case 'reasoning_object': body.reasoning = { effort: request.effort }; break;
      case 'none': break;
      default:
        throw unsupported(`${ctx.provider}/${ctx.model}: reasoningFormat "${compat.reasoningFormat}" não existe no fio openai-responses`, ctx);
    }
  }

  // Só o que o chamador pediu: `model.maxTokens` é o TETO do modelo, não um valor a enviar.
  if (request.maxTokens !== undefined) body[compat.maxTokensField] = request.maxTokens;
  if (request.temperature !== undefined && compat.supportsTemperature) body.temperature = request.temperature;
  if (compat.supportsStore) body.store = false;

  // params: do modelo, depois da chamada (o último vence). Nunca sobrescrevem o que é do fio
  // (PROTECTED_KEYS); descartar uma chave protegida é deliberado e não gera erro.
  // `provider` (roteamento do OpenRouter) só passa com compat.providerRouting.
  const owned = Object.fromEntries(MERGED_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
  for (const layer of [model.params, request.params]) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (PROTECTED_KEYS.has(k) || v === undefined || (k === 'provider' && !compat.providerRouting)) continue;
      if (MERGED_KEYS.includes(k)) {
        if (isPlainObject(v)) body[k] = { ...(isPlainObject(body[k]) ? body[k] : {}), ...v, ...owned[k] };
        else if (owned[k] === undefined) body[k] = v;
        continue;
      }
      body[k] = v;
    }
  }

  // `toolChoice` explícito vence `params`, como no openai-completions.
  if (choice !== undefined) body.tool_choice = typeof choice === 'string' ? choice : { type: 'function', name: choice.name };

  return { url, headers, body };
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * `toolChoice` do pedido, conferido. Sem `tools` não há o que escolher: `invalid_request`, sem outro alvo.
 * @param {import('../types.js').ChatRequest} request @param {Ctx} ctx
 * @returns {import('../types.js').ToolChoice | undefined}
 */
function toolChoiceOf(request, ctx) {
  const choice = request.toolChoice;
  if (choice === undefined) return undefined;
  if (!request.tools?.length) throw invalid('toolChoice exige tools no pedido', ctx);
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

// ---------------------------------------------------------------------------------------
// input

/**
 * Mensagens da lib → itens de `input`. Todo item leva `type`.
 * @param {import('../types.js').ChatRequest} request @param {{ model: Model, provider: string }} ctx
 */
function buildInput(request, { model, provider }) {
  /** @type {Ctx} */
  const ctx = { provider, model: model.id };
  if (!Array.isArray(request.messages)) throw invalid('messages precisa ser uma lista', ctx);
  /** @type {Record<string, unknown>[]} */
  const out = [];

  const system = systemText(request.system);
  if (system !== undefined) out.push({ type: 'message', role: 'system', content: system });

  request.messages.forEach((msg, i) => {
    const where = `messages[${i}]`;
    if (!msg || typeof msg !== 'object') throw invalid(`${where}: mensagem malformada (esperado um objeto)`, ctx);

    if (msg.role === 'user') {
      out.push({ type: 'message', role: 'user', content: userContent(msg.content, model, ctx, where) });
    } else if (msg.role === 'assistant') {
      // Parte reasoning é ignorada de propósito: este fio não tem onde guardá-la, e o raciocínio de outro
      // provedor (assinado pela Anthropic, por exemplo) não pode quebrar o fallback.
      const text = textOnly(msg.content, 'assistant', ctx, where, true);
      const calls = msg.toolCalls ?? [];
      if (!Array.isArray(calls)) throw invalid(`${where}: toolCalls precisa ser uma lista`, ctx);
      // Turno vazio não diz nada ao modelo, e a Responses API aceita itens soltos: sem texto, não há message.
      if (text) out.push({ type: 'message', role: 'assistant', content: text });
      calls.forEach((call, k) => {
        const at = `${where}.toolCalls[${k}]`;
        if (!call || typeof call !== 'object') throw invalid(`${at}: tool_call malformado (esperado um objeto)`, ctx);
        if (typeof call.name !== 'string' || !call.name) throw invalid(`${at}: tool_call precisa de name`, ctx);
        if (typeof call.id !== 'string' || !call.id) throw invalid(`${at}: tool_call precisa de id`, ctx);
        out.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments || '{}' });
      });
    } else if (msg.role === 'tool') {
      if (!msg.toolCallId) throw invalid(`${where}: mensagem tool sem toolCallId`, ctx);
      const text = textOnly(msg.content, 'tool', ctx, where);
      out.push({ type: 'function_call_output', call_id: msg.toolCallId, output: msg.isError === true ? TOOL_ERROR_PREFIX + text : text });
    } else {
      throw invalid(`${where}: papel de mensagem desconhecido: ${String(/** @type {any} */ (msg).role)}`, ctx);
    }
  });
  return out;
}

/**
 * System como um texto só, sem separador: o chamador corta o system em offsets arbitrários, e um
 * '\n\n' inserido mudaria o texto e quebraria o prefixo do cache automático. Marca de cache não vai.
 * @param {import('../types.js').System|undefined} system
 */
function systemText(system) {
  if (system === undefined || system === '') return undefined;
  const text = typeof system === 'string' ? system : system.map((b) => b.text).join('');
  return text === '' ? undefined : text;
}

/**
 * Conteúdo do papel user: o texto simples fica string; com partes, a lista de `input_*`.
 * @param {string | Part[]} content @param {Model} model @param {Ctx} ctx @param {string} where
 */
function userContent(content, model, ctx, where) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw invalid(`${where}: content precisa ser string ou lista de partes`, ctx);
  return content.map((part, j) => {
    const at = `${where}.content[${j}]`;
    if (!part || typeof part !== 'object') throw invalid(`${at}: parte malformada (esperado um objeto)`, ctx);
    if (part.type === 'text') return { type: 'input_text', text: part.text };
    if (part.type === 'audio' || part.type === 'video') {
      throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: a Responses API não lê ${part.type} (só texto, imagem e arquivo)`, ctx);
    }
    if (part.type !== 'image' && part.type !== 'file' && part.type !== 'reasoning') {
      throw invalid(`${at}: tipo de parte "${/** @type {any} */ (part).type}" desconhecido`, ctx);
    }
    assertMediaSupported(part, model, { provider: ctx.provider }); // reasoning cai aqui como invalid_request
    if (part.type === 'image') {
      return { type: 'input_image', image_url: part.data !== undefined ? asDataUrl(part.data, part.mime) : part.url };
    }
    if (part.type === 'file') {
      if (part.data === undefined) return { type: 'input_file', filename: part.name ?? defaultFilename(part.mime), file_url: part.url };
      const fileData = asDataUrl(part.data, part.mime);
      return { type: 'input_file', filename: part.name ?? defaultFilename(part.mime ?? parseDataUrl(fileData)?.mime), file_data: fileData };
    }
    throw invalid(`${at}: parte reasoning só existe no papel assistant`, ctx);
  });
}

/** @param {string} data @param {string|undefined} mime */
const asDataUrl = (data, mime) => (data.startsWith('data:') ? data : `data:${mime};base64,${data}`);

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

/** Status HTTP do `code` textual de um erro da Responses API; o que não conhecemos é 500 (`upstream`). */
const STATUS_BY_CODE = Object.freeze({
  invalid_api_key: 401, authentication_error: 401, permission_denied: 403,
  rate_limit_exceeded: 429, insufficient_quota: 429, rate_limit_error: 429,
  invalid_request_error: 400, invalid_prompt: 400, context_length_exceeded: 400, invalid_image: 400, invalid_value: 400,
  model_not_found: 404, server_error: 500,
});

/** @param {any} error @returns {number} */
function statusOfError(error) {
  const code = error?.code;
  const n = typeof code === 'string' && /^\d+$/.test(code) ? Number(code) : code;
  if (typeof n === 'number' && Number.isInteger(n) && n >= 100 && n <= 599) return n;
  const table = /** @type {Record<string, number>} */ (STATUS_BY_CODE);
  return table[String(code)] ?? table[String(error?.type)] ?? 500;
}

/**
 * `usage` da Responses API → Usage. `input_tokens` inclui o cache lido; `output_tokens` inclui o raciocínio.
 * @param {any} u @returns {import('../types.js').Usage}
 */
function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return makeUsage({ raw: null });
  const cacheRead = num(u.input_tokens_details?.cached_tokens);
  const cacheWrite = num(u.input_tokens_details?.cache_write_tokens);
  const reasoning = u.output_tokens_details?.reasoning_tokens;
  return makeUsage({
    input: Math.max(0, num(u.input_tokens) - cacheRead - cacheWrite),
    output: num(u.output_tokens),
    cacheRead,
    cacheWrite,
    ...(typeof reasoning === 'number' && Number.isFinite(reasoning) ? { reasoning } : {}),
    raw: u,
  });
}

/**
 * `incomplete_details.reason` → vocabulário da lib. Razão que não conhecemos passa como veio.
 * @param {unknown} reason
 */
function incompleteReason(reason) {
  if (reason === 'max_output_tokens') return 'length';
  if (typeof reason === 'string' && reason) return reason;
  return 'incomplete';
}

/**
 * Lê os eventos SSE da Responses API e rende text/reasoning/tool_call; devolve o resumo no `return`.
 * O fim limpo é `response.completed` ou `response.incomplete`; stream sem eles foi cortado e dá `upstream`.
 * @type {ApiModule['parseStream']}
 */
export async function* parseStream(events, { account, model }) {
  let refused = false;
  /** @type {Ctx} */
  const ctx = { provider: account?.provider, model: model.id };
  /** item.id (ou output_index) → chamada em andamento @type {Map<string, { callId: string, name: string, args: string }>} */
  const calls = new Map();
  /** @type {Map<number, string>} output_index → item.id, para o delta que só traz o índice */
  const byIndex = new Map();
  let sawCall = false;
  let emitted = false;
  let callCount = 0;
  /** @type {any} */ let final = null;
  /** @type {'completed'|'incomplete'|null} */ let kind = null;

  /** @param {any} ev @param {string|undefined} itemId */
  const keyOf = (ev, itemId) => itemId ?? byIndex.get(ev.output_index) ?? `#${ev.output_index}`;
  /** @param {string} key */
  const callFor = (key) => {
    let c = calls.get(key);
    if (!c) { c = { callId: '', name: '', args: '' }; calls.set(key, c); }
    return c;
  };

  for await (const ev of events) {
    const data = ev.data.trim();
    if (data === '[DONE]') break;
    if (!data) continue;

    /** @type {any} */ let chunk;
    try { chunk = JSON.parse(data); } catch (cause) {
      throw new ProviderError({ type: 'upstream', ...ctx, body: data, cause, message: `${ctx.provider}/${ctx.model}: evento do stream não é JSON` });
    }
    const type = typeof chunk?.type === 'string' ? chunk.type : ev.event;

    switch (type) {
      case 'response.output_text.delta':
        if (typeof chunk.delta === 'string' && chunk.delta) { emitted = true; yield { type: 'text', text: chunk.delta }; }
        break;

      // O resumo do raciocínio (OpenAI) e o raciocínio bruto (modelos abertos, como o gpt-oss no llama.cpp).
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (typeof chunk.delta === 'string' && chunk.delta) { emitted = true; yield { type: 'reasoning', text: chunk.delta }; }
        break;

      case 'response.output_item.added':
        if (chunk.item?.type === 'function_call') {
          const key = keyOf(chunk, chunk.item.id);
          if (typeof chunk.output_index === 'number') byIndex.set(chunk.output_index, key);
          const c = callFor(key);
          if (typeof chunk.item.call_id === 'string') c.callId = chunk.item.call_id;
          if (typeof chunk.item.name === 'string') c.name = chunk.item.name;
          if (typeof chunk.item.arguments === 'string') c.args = chunk.item.arguments;
        }
        break;

      case 'response.function_call_arguments.delta':
        if (typeof chunk.delta === 'string') callFor(keyOf(chunk, chunk.item_id)).args += chunk.delta;
        break;

      case 'response.output_item.done':
        if (chunk.item?.type === 'function_call') {
          const key = keyOf(chunk, chunk.item.id);
          const c = calls.get(key) ?? { callId: '', name: '', args: '' };
          calls.delete(key);
          const item = chunk.item;
          const name = (typeof item.name === 'string' && item.name) || c.name;
          const args = (typeof item.arguments === 'string' && item.arguments) || c.args;
          if (!name) {
            throw new ProviderError({ type: 'upstream', ...ctx, body: data, message: `${ctx.provider}/${ctx.model}: function_call sem nome no stream` });
          }
          // Cortada pelo limite de tokens ou JSON incompleto: emitir `arguments` inválido como se fosse
          // completo faria o chamador executar a ferramenta com lixo.
          const text = args.trim() ? args : '{}';
          let valid = true;
          try { JSON.parse(text); } catch { valid = false; }
          if (!valid) {
            throw new ProviderError({ type: 'upstream', ...ctx, body: data, message: `${ctx.provider}/${ctx.model}: tool call cortada (${name}, arguments não é JSON)` });
          }
          sawCall = true;
          emitted = true;
          yield /** @type {const} */ ({ type: 'tool_call', id: (typeof item.call_id === 'string' && item.call_id) || c.callId || item.id || `call_${callCount}`, name, arguments: text });
          callCount += 1;
        }
        break;

      // Recusa do modelo: o texto chega como resposta, e o fim diz que foi recusa.
      case 'response.refusal.delta':
        if (typeof chunk.delta === 'string' && chunk.delta) { emitted = true; refused = true; yield { type: 'text', text: chunk.delta }; }
        break;

      case 'response.completed':
        final = chunk.response ?? {};
        kind = 'completed';
        break;
      case 'response.incomplete':
        final = chunk.response ?? {};
        kind = 'incomplete';
        break;

      case 'response.failed':
        throw streamError(chunk.response?.error, chunk, ctx, emitted);
      case 'error':
        throw streamError(chunk?.error && typeof chunk.error === 'object' ? chunk.error : chunk, chunk, ctx, emitted);

      default:
        // response.created, in_progress, content_part.*, *.done, refusal… sem evento da lib.
        break;
    }
    if (kind) break;
  }

  if (!kind) {
    throw new ProviderError({ type: 'upstream', ...ctx, message: `${ctx.provider}/${ctx.model}: stream terminou sem evento final (response.completed, response.incomplete ou response.failed)` });
  }
  const finishReason = kind === 'incomplete'
    ? incompleteReason(final.incomplete_details?.reason)
    : sawCall ? 'tool_calls' : refused ? 'content_filter' : 'stop';
  return {
    finishReason,
    usage: normalizeUsage(final.usage),
    reportedCostUsd: reportedCost(final.usage?.cost),
  };
}

/**
 * Erro de `response.failed` ou `error`. Sem código nem tipo vira `upstream` (HTTP 500).
 * @param {any} error @param {any} chunk @param {Ctx} ctx @param {boolean} emitted
 */
function streamError(error, chunk, ctx, emitted) {
  const e = error && typeof error === 'object' ? error : {};
  return errorFromStatus(statusOfError(e), {
    ...ctx, body: chunk, emitted,
    message: typeof e.message === 'string' && e.message ? e.message : typeof error === 'string' ? error : undefined,
  });
}
