// ok-gateway-providers — `params` (porta de escape do corpo) e o que vale quando o pedido também diz.
//
// Regra única dos quatro fios: `params` entram primeiro, depois todos os campos de controle do
// pedido (`maxTokens`, `temperature`, `toolChoice`, `stop`, `responseSchema`, `effort`, `reasoning`),
// num bloco só no fim do `buildRequest`. Objeto do corpo (`output_config`, `generationConfig`…) funde
// com o explícito vencendo campo a campo; sem valor explícito, o `params` passa.

/** @param {unknown} v @returns {v is Record<string, any>} */
export const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Copia as camadas de `params` (modelo, depois a chamada: a última vence) para o corpo. Chave protegida e
 * valor `undefined` ficam de fora; descartar chave protegida é deliberado e não gera erro.
 * @param {Record<string, any>} body
 * @param {(Record<string, unknown>|undefined)[]} layers
 * @param {(key: string) => boolean} skip
 */
export function applyParams(body, layers, skip) {
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined || skip(k)) continue;
      body[k] = v;
    }
  }
}

/**
 * Funde o objeto explícito no que o `params` já pôs em `body[key]` (o explícito vence campo a campo).
 * Sem explícito, não mexe. Nunca altera o objeto do chamador.
 * @param {Record<string, any>} body @param {string} key @param {Record<string, unknown>|undefined} explicit
 */
export function fuse(body, key, explicit) {
  if (!explicit) return;
  const fromParams = isPlainObject(body[key]) ? body[key] : {};
  body[key] = { ...fromParams, ...Object.fromEntries(Object.entries(explicit).filter(([, v]) => v !== undefined)) };
}
