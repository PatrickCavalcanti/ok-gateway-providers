// ok-gateway-providers — uso → custo em US$ (spec §9 e §15).
//
// O custo que o provedor informa vence ('provider'). Sem ele, a tabela do modelo
// ('table'). Sem tabela, `usd: null` ('none') — nunca um valor inventado.

/** @typedef {import('./types.js').Model} Model */
/** @typedef {import('./types.js').Usage} Usage */
/** @typedef {import('./types.js').Cost} Cost */
/** @typedef {import('./types.js').CostResult} CostResult */

const PER_MILLION = 1_000_000;

/** @param {unknown} v */
const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Faixa que vale para um prompt total (a de maior limite abaixo dele), ou null.
 * @param {Cost} cost @param {number} promptTokens
 */
export function tierFor(cost, promptTokens) {
  const tiers = Array.isArray(cost.tiers) ? [...cost.tiers].sort((a, b) => a.aboveInputTokens - b.aboveInputTokens) : [];
  let chosen = null;
  for (const t of tiers) if (promptTokens > t.aboveInputTokens) chosen = t;
  return chosen;
}

/**
 * @param {Pick<Model, 'cost'>} model
 * @param {Partial<Usage>} usage
 * @param {number|null} [reportedUsd]  o custo que o provedor informou (`usage.cost` no OpenRouter)
 * @returns {CostResult}
 */
export function computeCost(model, usage, reportedUsd) {
  if (typeof reportedUsd === 'number' && Number.isFinite(reportedUsd) && reportedUsd >= 0) {
    return { usd: reportedUsd, source: 'provider' };
  }
  const cost = model?.cost;
  if (!cost || typeof cost.input !== 'number' || typeof cost.output !== 'number') return { usd: null, source: 'none' };

  const input = n(usage?.input);
  const output = n(usage?.output);
  const cacheRead = n(usage?.cacheRead);
  const cacheWrite = n(usage?.cacheWrite);
  const cacheWrite1h = n(usage?.cacheWrite1h);

  const tier = tierFor(cost, input + cacheRead + cacheWrite + cacheWrite1h);
  const rIn = tier?.input ?? cost.input;
  const rOut = tier?.output ?? cost.output;
  // Cache sem preço declarado sai ao preço de input: a lib não inventa desconto (§15.4).
  const rRead = tier?.cacheRead ?? cost.cacheRead ?? rIn;
  const rWrite = tier?.cacheWrite ?? cost.cacheWrite ?? rIn;
  const rWrite1h = tier?.cacheWrite1h ?? cost.cacheWrite1h ?? rIn;

  let usd = (input * rIn + output * rOut + cacheRead * rRead + cacheWrite * rWrite + cacheWrite1h * rWrite1h) / PER_MILLION;

  const seconds = n(usage?.audioSeconds);
  if (seconds && n(cost.audioPerSecond)) {
    usd += Math.max(seconds, n(cost.minBilledSeconds)) * /** @type {number} */ (cost.audioPerSecond);
  }
  return { usd, source: 'table' };
}
