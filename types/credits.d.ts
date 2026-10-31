/**
 * @param {{ creditsPerUsd: number, rounding?: 'ceil'|'round'|'none', decimals?: number }} opts
 * @returns {{ creditsPerUsd: number, toCredits(usd: number|null|undefined): number|null }}
 */
export function createCreditConverter({ creditsPerUsd, rounding, decimals }: {
    creditsPerUsd: number;
    rounding?: "ceil" | "round" | "none";
    decimals?: number;
}): {
    creditsPerUsd: number;
    toCredits(usd: number | null | undefined): number | null;
};
