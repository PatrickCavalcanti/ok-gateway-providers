// ok-gateway-providers — conversor US$ → créditos (spec §9, §15.6).
//
// Opcional: o Igris não cria o conversor; o Gateway usa
// `{ creditsPerUsd: 5500, rounding: 'round', decimals: 6 }`.

/**
 * @param {{ creditsPerUsd: number, rounding?: 'ceil'|'round'|'none', decimals?: number }} opts
 * @returns {{ creditsPerUsd: number, toCredits(usd: number|null|undefined): number|null }}
 */
export function createCreditConverter({ creditsPerUsd, rounding = 'round', decimals = 0 }) {
  if (typeof creditsPerUsd !== 'number' || !Number.isFinite(creditsPerUsd) || creditsPerUsd <= 0) {
    throw new TypeError(`creditsPerUsd precisa ser um número positivo (veio ${creditsPerUsd})`);
  }
  if (!['ceil', 'round', 'none'].includes(rounding)) {
    throw new TypeError(`rounding precisa ser 'ceil', 'round' ou 'none' (veio ${rounding})`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
    throw new TypeError(`decimals precisa ser um inteiro entre 0 e 12 (veio ${decimals})`);
  }
  const factor = 10 ** decimals;
  return {
    creditsPerUsd,
    toCredits(usd) {
      if (usd === null || usd === undefined) return null;
      if (typeof usd !== 'number' || !Number.isFinite(usd)) return null;
      const credits = usd * creditsPerUsd;
      if (rounding === 'none') return credits;
      // toPrecision(15) tira o ruído de ponto flutuante antes do teto (0.1 × 5500 = 550.0000000000001).
      const scaled = Number((credits * factor).toPrecision(15));
      return (rounding === 'ceil' ? Math.ceil(scaled) : Math.round(scaled)) / factor;
    },
  };
}
