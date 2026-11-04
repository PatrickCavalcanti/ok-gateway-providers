// ok-gateway-providers — funções puras do gravador de fixtures (spec §8).
// Separadas de scripts/record-fixture.mjs para o teste importar sem executar o script.

const KEEP_HEADERS = new Set(['content-type', 'x-generation-id']);

/**
 * Tira do texto a chave informada e qualquer coisa com cara de chave.
 * @param {string} s
 * @param {string} [key] chave exata, vinda do ambiente
 * @returns {string}
 */
export function scrub(s, key) {
  const exact = key ? s.split(key).join('<REDACTED>') : s;
  return exact
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, '<REDACTED>')
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, '<REDACTED>')
    .replace(/(x-goog-api-key\s*[:=]\s*["']?)[A-Za-z0-9_-]{10,}/gi, '$1<REDACTED>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{10,}/g, 'Bearer <REDACTED>');
}

/**
 * Só os headers que valem para diagnóstico. Os demais, inclusive autenticação e cookie, somem.
 * @param {{ forEach(cb: (value: string, name: string) => void): void }} headers `Headers` ou `Map`
 * @returns {Record<string, string>}
 */
export function selectHeaders(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  headers.forEach((value, name) => {
    const k = name.toLowerCase();
    if (KEEP_HEADERS.has(k)) out[k] = value;
  });
  return out;
}

/**
 * Descreve um corpo multipart pelos campos e pelo tamanho do arquivo, sem os bytes.
 * Objeto comum volta como está. O resultado vai para `.request.json`, que passa por `scrub`.
 * @param {any} body
 * @returns {any}
 */
export function describeBody(body) {
  if (!(body instanceof FormData)) return body;
  /** @type {Record<string, unknown>} */
  const out = {};
  body.forEach((value, field) => {
    out[field] = typeof value === 'string' ? value : { name: value.name, type: value.type, bytes: value.size };
  });
  return out;
}
