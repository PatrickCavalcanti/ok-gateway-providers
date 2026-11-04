/**
 * Uso a partir dos campos conhecidos. Sem nenhum número, `missing`: uso não declarado não é zero.
 * @param {Partial<Usage>} [partial] @returns {Usage}
 */
export function makeUsage(partial?: Partial<Usage>): Usage;
export function num(v: unknown): number;
export function reportedCost(v: unknown): number | null;
export type Usage = import("./types.js").Usage;
