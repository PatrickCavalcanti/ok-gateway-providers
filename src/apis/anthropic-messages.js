// ok-gateway-providers — fio `anthropic-messages` (spec §11).
//
// Monta o corpo de `POST {baseUrl}/messages` e lê o SSE da Messages API. Fetch, status
// HTTP, prazos e custo são do `client.js`; aqui só o formato do fio.

import { ProviderError, errorFromStatus, unsupported } from '../errors.js';
import { applyParams, fuse } from '../params.js';

/** @typedef {import('../types.js').Model} Model */
/** @typedef {import('../types.js').Part} Part */
/** @typedef {import('../types.js').Message} Message */
/** @typedef {import('../types.js').ResolvedCompat} ResolvedCompat */
/** @typedef {import('../types.js').ChatRequest} ChatRequest */
/** @typedef {import('../types.js').CacheMark} CacheMark */
/** @typedef {import('../types.js').Usage} Usage */
/** @typedef {import('../types.js').StreamSummary} StreamSummary */
/** @typedef {import('../sse.js').SSEEvent} SSEEvent */
/** @typedef {Record<string, any>} Block */
/** @typedef {{ provider: string, model: string }} Ctx */

export const api = 'anthropic-messages';

const ANTHROPIC_VERSION = '2023-06-01';
/** Chaves do corpo que `params` nunca sobrescreve. */
const PROTECTED = new Set(['model', 'messages', 'system', 'stream', 'tools']);

/**
 * Monta o pedido HTTP. Lança `ProviderError` `unsupported` / `invalid_request` antes do fetch.
 * @type {import('../types.js').ApiModule['buildRequest']}
 */
export function buildRequest({ account, model, compat, request, apiKey }) {
  /** @type {Ctx} */
  const ctx = { provider: account.provider, model: model.id };
  if (request.cachedContent !== undefined) {
    throw unsupported(`${ctx.provider}/${ctx.model}: cachedContent só existe no fio google-generative-ai`, ctx);
  }

  const system = buildSystem(request.system, compat);
  if (!Array.isArray(request.messages)) throw invalid('messages precisa ser uma lista', ctx);
  const messages = buildMessages(request.messages, model, compat, ctx);

  // Esta API não tem orçamento de raciocínio no pedido (o `effort` é o único controle).
  if (request.reasoning && (request.reasoning.maxTokens !== undefined || request.reasoning.exclude !== undefined)) {
    throw unsupported(`${ctx.provider}/${ctx.model}: reasoning.maxTokens/exclude só existem com reasoningFormat "reasoning_object" (o fio anthropic-messages usa só effort)`, ctx);
  }

  const effort = request.effort;
  const adaptive = effort !== undefined && effort !== 'none';
  // O thinking vai rodar: adaptive pedido por `effort`, ou o padrão do modelo sem `effort: 'none'`.
  const thinkingOn = compat.reasoningFormat === 'anthropic_thinking'
    && (adaptive || (effort !== 'none' && !!compat.thinkingByDefault));

  /** @type {Record<string, any>} */
  const body = {
    model: model.id,
    // O `model.maxTokens` do catálogo é o teto do modelo, não um padrão: não entra aqui.
    // Com o thinking rodando ele consome o orçamento de saída, então o padrão sobe para 16000.
    max_tokens: request.maxTokens ?? (thinkingOn ? 16000 : 1024),
    messages,
    stream: true,
  };
  if (system) body.system = system;

  if (request.tools?.length) {
    body.tools = request.tools.map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      input_schema: t.parameters ?? { type: 'object', properties: {} },
    }));
  }

  const choice = toolChoiceOf(request, ctx);
  const stop = stopOf(request, ctx);

  if (request.responseSchema && compat.structuredOutput !== 'output_config') {
    throw unsupported(`${ctx.provider}/${ctx.model}: o modelo não declara saída estruturada (compat.structuredOutput = "${compat.structuredOutput}")`, ctx);
  }

  // params: do modelo, depois da chamada (o último vence).
  applyParams(body, [model.params, request.params], (k) => PROTECTED.has(k));

  // Campos de controle do pedido, num bloco só, depois dos params: o explícito vence. Objeto funde campo a campo.
  if (compat.reasoningFormat === 'anthropic_thinking' && effort !== undefined) {
    fuse(body, 'thinking', { type: adaptive ? 'adaptive' : 'disabled' });
    delete body.thinking.budget_tokens; // só o thinking `enabled` tem orçamento; sobra do params invalidaria o pedido
  }
  const outputConfig = {
    ...(compat.reasoningFormat === 'anthropic_thinking' && adaptive ? { effort } : {}),
    ...(request.responseSchema ? { format: { type: 'json_schema', schema: request.responseSchema.schema } } : {}),
  };
  if (Object.keys(outputConfig).length) fuse(body, 'output_config', outputConfig);
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  // Modelo que pensa por padrão responde 400 a `temperature`, mesmo com `effort: 'none'`
  // (o Gateway nunca a manda para eles); com o adaptive ligado ela também é recusada.
  // Um `temperature` que o próprio `params` trouxe é escolha do chamador e também é sobrescrito.
  if (request.temperature !== undefined && ((compat.supportsTemperature && !compat.thinkingByDefault && !thinkingOn) || 'temperature' in body)) {
    body.temperature = request.temperature;
  }
  if (choice !== undefined) body.tool_choice = typeof choice === 'object' ? { type: 'tool', name: choice.name } : { type: TOOL_CHOICE_TYPE[choice] };
  if (stop) body.stop_sequences = stop;

  return {
    url: `${account.baseUrl.replace(/\/+$/, '')}/messages`,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': versionOf(account, compat),
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body,
  };
}

/**
 * `anthropic-version` da conta ou do compat vence o padrão, sem diferença de caixa. Entre os dois vale a ordem do
 * cliente: o compat vence a conta.
 * @param {import('../types.js').Account} account @param {ResolvedCompat} compat
 */
function versionOf(account, compat) {
  for (const layer of [compat.headers, account.headers]) {
    for (const [k, v] of Object.entries(layer ?? {})) if (k.toLowerCase() === 'anthropic-version' && v) return v;
  }
  return ANTHROPIC_VERSION;
}

/** `toolChoice` textual → `tool_choice.type` da API. */
const TOOL_CHOICE_TYPE = /** @type {const} */ ({ auto: 'auto', none: 'none', required: 'any' });

/**
 * `toolChoice` do pedido, conferido. Sem `tools` não há o que escolher: `invalid_request`, sem outro alvo.
 * @param {ChatRequest} request @param {Ctx} ctx
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
 * @param {ChatRequest} request @param {Ctx} ctx @returns {string[] | undefined}
 */
function stopOf(request, ctx) {
  const stop = request.stop;
  if (stop === undefined) return undefined;
  if (!Array.isArray(stop) || stop.some((s) => typeof s !== 'string')) throw invalid('stop precisa ser uma lista de textos', ctx);
  return stop.length ? stop : undefined;
}

/** @param {CacheMark|undefined} cache @param {ResolvedCompat} compat @returns {Block} */
function cacheField(cache, compat) {
  if (!cache || compat.cacheMarker !== 'cache_control') return {};
  return { cache_control: cache.ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' } };
}

/** @param {ChatRequest['system']} system @param {ResolvedCompat} compat @returns {Block[]|undefined} */
function buildSystem(system, compat) {
  if (system === undefined || system === '') return undefined;
  if (typeof system === 'string') return [{ type: 'text', text: system }];
  const blocks = system
    .filter((b) => b.text)
    .map((b) => ({ type: 'text', text: b.text, ...cacheField(b.cache, compat) }));
  return blocks.length ? blocks : undefined;
}

/**
 * @param {Message[]} messages @param {Model} model @param {ResolvedCompat} compat @param {Ctx} ctx
 * @returns {{ role: 'user'|'assistant', content: Block[] }[]}
 */
function buildMessages(messages, model, compat, ctx) {
  /** @type {{ role: 'user'|'assistant', content: Block[] }[]} */
  const out = [];
  messages.forEach((msg, i) => {
    const where = `messages[${i}]`;
    if (!msg || typeof msg !== 'object') throw invalid(`${where}: mensagem malformada (esperado um objeto)`, ctx);
    if (msg.role === 'assistant') {
      // O raciocínio assinado precisa ir antes do texto e das tool calls, onde quer que a parte esteja na lista.
      const blocks = partsToBlocks(msg.content, model, compat, ctx, where, false);
      /** @type {Block[]} */
      const content = [...blocks.filter(isThinking), ...blocks.filter((b) => !isThinking(b))];
      const calls = msg.toolCalls ?? [];
      if (!Array.isArray(calls)) throw invalid(`${where}: toolCalls precisa ser uma lista`, ctx);
      calls.forEach((call, k) => {
        const at = `${where}.toolCalls[${k}]`;
        if (!call || typeof call !== 'object') throw invalid(`${at}: tool_call malformado (esperado um objeto)`, ctx);
        if (typeof call.id !== 'string' || !call.id) throw invalid(`${at}: tool_call precisa de id`, ctx);
        if (typeof call.name !== 'string' || !call.name) throw invalid(`${at}: tool_call precisa de name`, ctx);
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: parseArguments(call, at, ctx), ...cacheField(call.cache, compat) });
      });
      if (!content.length) throw invalid(`${where}: mensagem do assistente vazia (sem texto nem tool_calls)`, ctx);
      out.push({ role: 'assistant', content });
      return;
    }
    /** @type {Block[]} */
    let blocks;
    if (msg.role === 'tool') {
      if (!msg.toolCallId) throw invalid(`${where}: mensagem tool precisa de toolCallId`, ctx);
      blocks = [{
        type: 'tool_result',
        tool_use_id: msg.toolCallId,
        content: toolResultContent(msg.content, model, compat, ctx, where),
        ...(msg.isError === true ? { is_error: true } : {}),
        // A API aceita `cache_control` no próprio bloco tool_result; a marca da parte vem para cá.
        ...cacheField(toolResultCache(msg.content), compat),
      }];
    } else if (msg.role === 'user') {
      blocks = partsToBlocks(msg.content, model, compat, ctx, where, true);
      if (!blocks.length) throw invalid(`${where}: mensagem do usuário vazia`, ctx);
    } else {
      throw invalid(`${where}: papel "${/** @type {any} */ (msg).role}" não suportado (use user, assistant ou tool)`, ctx);
    }
    // tool_result e user seguidos viram uma única mensagem user; tool_result vai antes do resto.
    const last = out[out.length - 1];
    if (last?.role === 'user') {
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          let at = 0;
          while (at < last.content.length && last.content[at].type === 'tool_result') at++;
          last.content.splice(at, 0, b);
        } else last.content.push(b);
      }
    } else out.push({ role: 'user', content: blocks });
  });
  return out;
}

/** @param {Block} block */
const isThinking = (block) => block.type === 'thinking' || block.type === 'redacted_thinking';

/** @param {{ id: string, name: string, arguments: string }} call @param {string} where @param {Ctx} ctx */
function parseArguments(call, where, ctx) {
  const raw = call.arguments;
  if (raw === undefined || raw === null || String(raw).trim() === '') return {};
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('não é um objeto');
    return parsed;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw invalid(`${where}: arguments do tool_call "${call.name}" (${call.id}) não é um objeto JSON válido — ${why}`, ctx);
  }
}

/** Última marca de cache entre as partes de um resultado de tool. @param {unknown} content @returns {CacheMark|undefined} */
function toolResultCache(content) {
  if (!Array.isArray(content)) return undefined;
  for (let j = content.length - 1; j >= 0; j--) {
    if (content[j]?.cache) return content[j].cache;
  }
  return undefined;
}

/** @param {Message['content']} content @param {Model} model @param {ResolvedCompat} compat @param {Ctx} ctx @param {string} where */
function toolResultContent(content, model, compat, ctx, where) {
  if (typeof content === 'string') return content;
  const blocks = partsToBlocks(content, model, compat, ctx, where, true);
  // Só texto: string simples; com imagem: lista de blocos (a API aceita text e image).
  if (blocks.every((b) => b.type === 'text')) return blocks.map((b) => b.text).join('\n');
  return blocks.map(({ cache_control: _drop, ...b }) => b);
}

/**
 * @param {string|Part[]} content @param {Model} model @param {ResolvedCompat} compat
 * @param {Ctx} ctx @param {string} where @param {boolean} allowMedia
 * @returns {Block[]}
 */
function partsToBlocks(content, model, compat, ctx, where, allowMedia) {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) throw invalid(`${where}: content precisa ser string ou lista de partes`, ctx);
  /** @type {Block[]} */
  const out = [];
  content.forEach((part, j) => {
    const at = `${where}.content[${j}]`;
    if (!part || typeof part !== 'object') throw invalid(`${at}: parte malformada (esperado um objeto)`, ctx);
    switch (part.type) {
      case 'text':
        if (part.text) out.push({ type: 'text', text: part.text, ...cacheField(part.cache, compat) });
        return;
      case 'reasoning':
        // `allowMedia: false` é o papel assistant, o único que guarda raciocínio.
        if (allowMedia) throw invalid(`${at}: parte reasoning só existe no papel assistant`, ctx);
        // Sem assinatura (ou sem o bloco redigido) a API recusaria o bloco: a parte é ignorada. É o que
        // acontece com o raciocínio que veio de outro provedor, que não traz assinatura da Anthropic.
        if (part.redacted) out.push({ type: 'redacted_thinking', data: part.redacted });
        else if (part.signature) out.push({ type: 'thinking', thinking: part.text ?? '', signature: part.signature });
        return;
      case 'audio':
      case 'video':
        throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: a Messages API da Anthropic não aceita ${part.type === 'audio' ? 'áudio' : 'vídeo'}`, ctx);
      case 'image':
        if (!allowMedia) throw invalid(`${at}: o assistente não pode enviar imagem`, ctx);
        out.push({ ...imageBlock(part, model, ctx, at), ...cacheField(part.cache, compat) });
        return;
      case 'file':
        if (!allowMedia) throw invalid(`${at}: o assistente não pode enviar arquivo`, ctx);
        out.push({ ...documentBlock(part, model, ctx, at), ...cacheField(part.cache, compat) });
        return;
      default:
        throw invalid(`${at}: tipo de parte "${/** @type {any} */ (part).type}" desconhecido`, ctx);
    }
  });
  return out;
}

/**
 * Arquivo → bloco `document`. A Messages API lê PDF (base64 ou URL) e texto puro
 * (`source.type: 'text'`); outro tipo de arquivo dá `unsupported`, nunca é descartado.
 * @param {Extract<Part, { type: 'file' }>} part @param {Model} model @param {Ctx} ctx @param {string} at @returns {Block}
 */
function documentBlock(part, model, ctx, at) {
  if (!model.input?.includes('file')) {
    throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: o modelo não declara entrada de arquivo`, ctx);
  }
  const transport = model.transport?.file ?? ['data-url'];
  const raw = part.data ?? part.url;
  if (!raw) throw invalid(`${at}: arquivo precisa de data ou url`, ctx);
  /** @type {Block} */
  const title = part.name ? { title: part.name } : {};

  if (part.data !== undefined || raw.startsWith('data:')) {
    if (!transport.includes('data-url')) {
      throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: o modelo não aceita arquivo em data-url`, ctx);
    }
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(raw);
    const mediaType = (m?.[1] ?? part.mime ?? '').split(';')[0].trim().toLowerCase();
    const data = m ? m[3] : raw;
    if (m && !m[2]) throw invalid(`${at}: data-url de arquivo precisa ser base64`, ctx);
    if (!mediaType) throw invalid(`${at}: arquivo em base64 precisa de mime`, ctx);
    if (mediaType === 'application/pdf') {
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, ...title };
    }
    if (mediaType === 'text/plain') {
      const text = Buffer.from(data, 'base64').toString('utf8');
      return { type: 'document', source: { type: 'text', media_type: 'text/plain', data: text }, ...title };
    }
    throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: a Messages API só lê arquivo PDF ou text/plain (veio ${mediaType}); converta antes`, ctx);
  }
  if (!transport.includes('url')) {
    throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: o modelo só aceita arquivo em data-url (baixar a URL é papel do cliente)`, ctx);
  }
  const mime = (part.mime ?? 'application/pdf').split(';')[0].trim().toLowerCase();
  if (mime !== 'application/pdf') {
    throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: por URL a Messages API só lê PDF (veio ${mime})`, ctx);
  }
  return { type: 'document', source: { type: 'url', url: raw }, ...title };
}

/** @param {Extract<Part, { type: 'image' }>} part @param {Model} model @param {Ctx} ctx @param {string} at @returns {Block} */
function imageBlock(part, model, ctx, at) {
  if (!model.input?.includes('image')) {
    throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: o modelo não declara entrada de imagem`, ctx);
  }
  const transport = model.transport?.image ?? ['data-url', 'url'];
  const raw = part.data ?? part.url;
  if (!raw) throw invalid(`${at}: imagem precisa de data ou url`, ctx);

  // `data:` vindo em `url` conta como data-url.
  if (part.data !== undefined || raw.startsWith('data:')) {
    if (!transport.includes('data-url')) {
      throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: o modelo não aceita imagem em data-url`, ctx);
    }
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(raw);
    const mediaType = m?.[1] ?? part.mime;
    const data = m ? m[3] : raw;
    if (m && !m[2]) throw invalid(`${at}: data-url de imagem precisa ser base64`, ctx);
    if (!mediaType) throw invalid(`${at}: imagem em base64 precisa de mime`, ctx);
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  }
  if (!transport.includes('url')) {
    throw unsupported(`${ctx.provider}/${ctx.model}: ${at}: o modelo só aceita imagem em data-url (baixar a URL é papel do cliente)`, ctx);
  }
  return { type: 'image', source: { type: 'url', url: raw } };
}

/** @param {string} message @param {Ctx} ctx */
function invalid(message, ctx) {
  return new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, message: `${ctx.provider}/${ctx.model}: ${message}` });
}

/** Status HTTP equivalente ao `error.type` de um erro dentro do stream. @param {unknown} type */
function statusForErrorType(type) {
  switch (type) {
    case 'overloaded_error': return 529;
    case 'rate_limit_error': return 429;
    case 'invalid_request_error': return 400;
    case 'authentication_error': return 401;
    default: return 500;
  }
}

/** Mapeia `stop_reason` para o vocabulário da lib; o que não conhecemos passa como veio. @param {string} reason */
function mapStopReason(reason) {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool_calls';
  return reason;
}

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Normaliza o usage combinado (message_start + message_delta).
 * @param {Record<string, any>} raw @returns {Usage}
 */
function normalizeUsage(raw) {
  const cc = raw.cache_creation;
  const hasSplit = cc && typeof cc === 'object'
    && (typeof cc.ephemeral_5m_input_tokens === 'number' || typeof cc.ephemeral_1h_input_tokens === 'number');
  return {
    input: num(raw.input_tokens),
    output: num(raw.output_tokens),
    cacheRead: num(raw.cache_read_input_tokens),
    cacheWrite: hasSplit ? num(cc.ephemeral_5m_input_tokens) : num(raw.cache_creation_input_tokens),
    cacheWrite1h: hasSplit ? num(cc.ephemeral_1h_input_tokens) : 0,
    raw,
  };
}

/** Stream sem uso nenhum: zerado e marcado, para o custo ficar `none` e não US$ 0. @returns {Usage} */
function missingUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, missing: true };
}

/**
 * Lê o SSE da Messages API.
 * @type {import('../types.js').ApiModule['parseStream']}
 */
export async function* parseStream(sseEvents, { account, model }) {
  /** @type {Ctx} */
  const ctx = { provider: account.provider, model: model.id };
  /** @type {Record<string, any>} */
  let usageRaw = {};
  let stopReason = '';
  let stopped = false;
  /** @type {Map<number, { kind: string, id?: string, name?: string, json: string, initial?: unknown }>} */
  const blocks = new Map();

  /** @type {{ id: string, name: string, arguments: string }[]} */
  const pendingCalls = [];
  /** @type {string|undefined} */
  let lastBlockKind;
  for await (const sse of sseEvents) {
    /** @type {Record<string, any>} */
    let ev;
    try {
      ev = JSON.parse(sse.data);
    } catch {
      throw new ProviderError({ type: 'upstream', ...ctx, body: sse.data, message: `${ctx.provider}/${ctx.model}: evento SSE com JSON inválido` });
    }
    const type = ev?.type ?? sse.event;

    switch (type) {
      case 'ping':
        break;
      case 'message_start':
        usageRaw = { ...usageRaw, ...(ev.message?.usage ?? {}) };
        break;
      case 'content_block_start': {
        const b = ev.content_block ?? {};
        const kind = b.type;
        blocks.set(ev.index, { kind, id: b.id, name: b.name, json: '', initial: b.input });
        if (kind === 'text' && b.text) yield { type: 'text', text: b.text };
        else if (kind === 'thinking' && b.thinking) yield { type: 'reasoning', text: b.thinking };
        // Bloco que a API cifrou: sem texto, e precisa voltar como veio. O `data` é opaco.
        else if (kind === 'redacted_thinking' && b.data) yield { type: 'reasoning', text: '', redacted: b.data };
        break;
      }
      case 'content_block_delta': {
        const d = ev.delta ?? {};
        const blk = blocks.get(ev.index);
        if (d.type === 'text_delta' && d.text) yield { type: 'text', text: d.text };
        else if (d.type === 'thinking_delta' && d.thinking) yield { type: 'reasoning', text: d.thinking };
        // A assinatura fecha o bloco `thinking`: o chamador a junta ao texto que já recebeu e a devolve na parte reasoning.
        else if (d.type === 'signature_delta' && d.signature) yield { type: 'reasoning', text: '', signature: d.signature };
        else if (d.type === 'input_json_delta' && blk) blk.json += d.partial_json ?? '';
        // outros deltas: não viram evento.
        break;
      }
      case 'content_block_stop': {
        const blk = blocks.get(ev.index);
        blocks.delete(ev.index);
        if (blk) lastBlockKind = blk.kind;
        if (blk?.kind === 'tool_use') {
          let args = blk.json.trim();
          if (!args) {
            const init = blk.initial;
            args = init && typeof init === 'object' && Object.keys(init).length ? JSON.stringify(init) : '{}';
          }
          // Só sai no fim: o stop_reason (max_tokens) chega depois do content_block_stop.
          pendingCalls.push({ id: String(blk.id ?? ''), name: String(blk.name ?? ''), arguments: args });
        }
        break;
      }
      case 'message_delta': {
        if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        const u = ev.usage ?? {};
        usageRaw = {
          ...usageRaw,
          ...Object.fromEntries(Object.entries(u).filter(([, v]) => v !== null && v !== undefined)),
        };
        break;
      }
      case 'message_stop':
        stopped = true;
        break;
      case 'error': {
        const err = ev.error ?? {};
        throw errorFromStatus(statusForErrorType(err.type), {
          ...ctx,
          body: sse.data,
          message: [err.type, err.message].filter(Boolean).join(': ') || undefined,
        });
      }
      default:
        break; // tipos novos que a Anthropic acrescentar: ignorados de propósito
    }
    if (stopped) break;
  }

  if (!stopped) {
    throw new ProviderError({ type: 'upstream', ...ctx, message: `${ctx.provider}/${ctx.model}: stream terminou sem message_stop (resposta cortada)` });
  }
  // Tool call cortada: o último bloco era tool_use e o limite de tokens encerrou a mensagem,
  // ou o JSON acumulado não fecha. Emitir como completa faria o chamador rodar a ferramenta com lixo.
  const cutLast = stopReason === 'max_tokens' && lastBlockKind === 'tool_use';
  for (let i = 0; i < pendingCalls.length; i++) {
    const c = pendingCalls[i];
    let valid = true;
    try { JSON.parse(c.arguments); } catch { valid = false; }
    if (!valid || (cutLast && i === pendingCalls.length - 1)) {
      throw new ProviderError({ type: 'upstream', ...ctx, message: `${ctx.provider}/${ctx.model}: tool call cortada (${c.name}${valid ? ', stop_reason max_tokens' : ', input não é JSON'})` });
    }
  }
  for (const c of pendingCalls) yield { type: 'tool_call', ...c };
  return {
    finishReason: stopReason ? mapStopReason(stopReason) : 'stop',
    usage: Object.keys(usageRaw).length ? normalizeUsage(usageRaw) : missingUsage(),
    reportedCostUsd: null,
  };
}
