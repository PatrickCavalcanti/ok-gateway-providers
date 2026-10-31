/**
 * Faixa que vale para um prompt total (a de maior limite abaixo dele), ou null.
 * @param {Cost} cost @param {number} promptTokens
 */
export function tierFor(cost: Cost, promptTokens: number): import("./types.js").CostTier | null;
/**
 * @param {Pick<Model, 'cost'>} model
 * @param {Partial<Usage>} usage
 * @param {number|null} [reportedUsd]  o custo que o provedor informou (`usage.cost` no OpenRouter)
 * @returns {CostResult}
 */
export function computeCost(model: Pick<Model, "cost">, usage: Partial<Usage>, reportedUsd?: number | null): CostResult;
export type Model = import("./types.js").Model;
export type Usage = import("./types.js").Usage;
export type Cost = import("./types.js").Cost;
export type CostResult = import("./types.js").CostResult;
