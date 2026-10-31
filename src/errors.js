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

export class ProviderError extends Error {
  /**
   * @param {{
   *   type: ErrorType, message: string, retryOther?: boolean, emitted?: boolean,
   *   status?: number, provider?: string, model?: string, body?: unknown, cause?: unknown,
   * }} init
   */
  constructor({ type, message, retryOther, emitted = false, status, provider, model, body, cause }) {
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
