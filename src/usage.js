// ok-gateway-providers — uso normalizado das operações de chamada única.

/** @typedef {import('./types.js').Usage} Usage */

/** Número positivo e finito; o resto vira 0. @param {unknown} v */
export const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Uso a partir dos campos conhecidos. Sem nenhum número, `missing`: uso não declarado não é zero.
 * @param {Partial<Usage>} [partial] @returns {Usage}
 */
export function makeUsage(partial = {}) {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, ...partial };
  const declared = usage.input || usage.output || usage.cacheRead || usage.cacheWrite || usage.cacheWrite1h || usage.audioSeconds;
  return declared ? usage : { ...usage, missing: true };
}

/** Custo informado pelo provedor, ou null. @param {unknown} v */
export const reportedCost = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
