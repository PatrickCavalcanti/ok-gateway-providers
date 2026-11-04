// ok-gateway-providers — erro tipado (spec §8).
//
// O consumidor decide o fallback com uma regra só: passa ao próximo alvo quando
// `retryOther && !emitted`. A lib nunca repete chamada.

/** @typedef {'auth'|'rate_limit'|'invalid_request'|'upstream'|'timeout'|'unsupported'|'aborted'} ErrorType */

export const MAX_BODY_BYTES = 2048;

/** Corta o corpo em até 2 KB (em bytes UTF-8). @param {unknown} text @returns {string|undefined} */
export function truncateBody(text) {
  if (text === undefined || text === null) return undefined;
  const s = typeof text === 'string' ? text : safeStringify(text);
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= MAX_BODY_BYTES) return s;
  // Corta em fronteira de caractere: decodificar o prefixo pode deixar um U+FFFD no fim.
  return buf.subarray(0, MAX_BODY_BYTES).toString('utf8').replace(/�+$/, '');
}

/** @param {unknown} v */
function safeStringify(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} v @returns {string|undefined} */
const text = (v) => (typeof v === 'string' && v ? v : undefined);
/** @param {unknown} v @returns {string|number|undefined} */
const codeOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : capped(text(v)));

/** Campo de diagnóstico tem teto: o corpo é do provedor. @param {string|undefined} v */
const capped = (v) => (v && v.length > 200 ? v.slice(0, 200) : v);

/**
 * @typedef {object} Diagnostic
 * @property {string|number} [code]  `error.code` do corpo (HTTP 429, `server_error`, `context_length_exceeded`…)
 * @property {string} [errorType]  `error.metadata.error_type` (OpenRouter), `error.type` (Anthropic, OpenAI) ou `error.status` (Gemini)
 * @property {string|number} [providerCode]  `error.metadata.provider_code`: o código do provedor por trás do roteador
 * @property {string} [providerName]  `error.metadata.provider_name`: o provedor por trás do roteador
 */

/**
 * O que um corpo de erro diz sobre a falha, sem o texto cru: lê `{ error: {...} }` (OpenRouter, Anthropic, OpenAI,
 * Gemini), o evento `response.failed` e o evento `error` da Responses API. Corpo que não é JSON ou não é um erro
 * dá `{}`. Aceita o texto da resposta ou o objeto já lido.
 * @param {unknown} body @returns {Diagnostic}
 */
export function diagnosticFields(body) {
  /** @type {unknown} */
  let b = body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return {}; } }
  if (!isRecord(b)) return {};
  const nested = isRecord(b.error) ? b.error : isRecord(b.response?.error) ? b.response.error : null;
  // Sem objeto `error`, o próprio evento é o erro quando se declara assim (`{ type: 'error', code, message }`).
  const e = nested ?? (b.type === 'error' ? b : null);
  if (!e) return {};
  const md = isRecord(e.metadata) ? e.metadata : {};
  const code = codeOf(e.code);
  const providerCode = codeOf(md.provider_code);
  const errorType = capped(text(md.error_type) ?? (e === b ? undefined : text(e.type) ?? text(e.status)));
  const providerName = capped(text(md.provider_name));
  return {
    ...(code !== undefined ? { code } : {}),
    ...(errorType ? { errorType } : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
    ...(providerName ? { providerName } : {}),
  };
}

export class ProviderError extends Error {
  /**
   * @param {{
   *   type: ErrorType, message: string, retryOther?: boolean, emitted?: boolean,
   *   status?: number, provider?: string, model?: string, body?: unknown, cause?: unknown,
   *   code?: string|number, errorType?: string, providerCode?: string|number, providerName?: string, generationId?: string,
   * }} init
   *   `code`, `errorType`, `providerCode` e `providerName` que faltam saem do `body`; `generationId` o cliente preenche
   *   (header `x-generation-id`)
   */
  constructor({ type, message, retryOther, emitted = false, status, provider, model, body, cause, generationId, ...diagnostic }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ProviderError';
    /** @type {ErrorType} */
    this.type = type;
    /** @type {boolean} */
    this.retryOther = retryOther ?? type !== 'aborted';
    /** @type {boolean} */
    this.emitted = emitted;
    /** @type {number|undefined} */
    this.status = status;
    /** @type {string|undefined} */
    this.provider = provider;
    /** @type {string|undefined} */
    this.model = model;
    /** @type {string|undefined} */
    this.body = truncateBody(body);
    const found = { ...diagnosticFields(body), ...Object.fromEntries(Object.entries(diagnostic).filter(([, v]) => v !== undefined)) };
    /** Código do erro no corpo (`error.code`). @type {string|number|undefined} */
    this.code = found.code;
    /** Tipo do erro no corpo (`error.metadata.error_type`, `error.type` ou `error.status`). @type {string|undefined} */
    this.errorType = found.errorType;
    /** Código do provedor por trás do roteador (`error.metadata.provider_code`). @type {string|number|undefined} */
    this.providerCode = found.providerCode;
    /** Provedor por trás do roteador (`error.metadata.provider_name`). @type {string|undefined} */
    this.providerName = found.providerName;
    /** Id da geração no provedor (header `x-generation-id`), para diagnóstico. @type {string|undefined} */
    this.generationId = generationId;
  }
}

/** @param {number} status @returns {ErrorType} */
export function typeFromStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'upstream';
  if (status >= 400) return 'invalid_request';
  return 'upstream';
}

/**
 * Erro a partir de um status HTTP (ou do código de um erro no corpo do stream).
 * @param {number} status
 * @param {{ provider?: string, model?: string, body?: unknown, emitted?: boolean, message?: string }} [ctx]
 */
export function errorFromStatus(status, { provider, model, body, emitted = false, message } = {}) {
  const type = typeFromStatus(status);
  const detail = message ?? extractMessage(body);
  return new ProviderError({
    type,
    status,
    provider,
    model,
    body,
    emitted,
    message: `${provider ?? 'provider'}/${model ?? '?'}: HTTP ${status}${detail ? ` — ${detail}` : ''}`,
  });
}

/** Mensagem legível de um corpo de erro em JSON (`{ error: { message } }` e variações). @param {unknown} body */
export function extractMessage(body) {
  /** @type {unknown} */
  let b = body;
  if (typeof body === 'string') {
    try { b = JSON.parse(body); } catch { return body.slice(0, 300) || undefined; }
  }
  if (b && typeof b === 'object') {
    const o = /** @type {any} */ (b);
    const m = o.error?.message ?? o.message ?? (typeof o.error === 'string' ? o.error : undefined);
    if (typeof m === 'string') return m.slice(0, 300);
  }
  return undefined;
}

/** Mídia ou parâmetro que o modelo não suporta — sempre antes do fetch. @param {string} message @param {{ provider?: string, model?: string }} [ctx] */
export function unsupported(message, { provider, model } = {}) {
  return new ProviderError({ type: 'unsupported', retryOther: true, provider, model, message });
}
