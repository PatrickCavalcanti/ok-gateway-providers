import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCost, tierFor } from '../src/cost.js';

const close = (/** @type {number|null} */ a, /** @type {number} */ b, msg = '') =>
  assert.ok(a !== null && Math.abs(a - b) < 1e-12, `${msg} esperava ${b}, veio ${a}`);

const usage = (/** @type {Record<string, number>} */ u) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, ...u });

// ---- Linhas do Gateway (igris-gateway/src/credits/pricing.ts) e a fórmula dele ----

const HAIKU_GATEWAY = {
  usdPerMTokInput: 0.10, usdPerMTokOutput: 0.50, usdPerMTokCachedInput: 0.01,
  usdPerMTokCacheWriteInput: 0.125, usdPerMTokCacheWrite1hInput: 0.20,
  longContext: { thresholdTokens: 100_000, multiplier: 5 },
};
const GROQ_TURBO_GATEWAY = {
  usdPerMTokInput: 0, usdPerMTokOutput: 0, usdPerSecondAudio: 0.04 / 3600, minBilledSecondsAudio: 10,
};

/**
 * Port de `computeCredits` (até o `usdTotal`, sem converter em créditos). No Gateway
 * `cacheCreationInputTokens` INCLUI as escritas de 1 h.
 * @param {Record<string, any>} cost
 * @param {{ inputTokens: number, outputTokens: number, cachedInputTokens?: number, cacheCreationInputTokens?: number, cacheCreation1hInputTokens?: number, audioInputSeconds?: number }} u
 */
function gatewayUsd(cost, u) {
  const cachedRate = cost.usdPerMTokCachedInput ?? cost.usdPerMTokInput * 0.1;
  const cacheWriteRate = cost.usdPerMTokCacheWriteInput ?? cost.usdPerMTokInput * 1.25;
  const cacheWrite1hRate = cost.usdPerMTokCacheWrite1hInput ?? cost.usdPerMTokInput * 2;
  const cachedIn = u.cachedInputTokens ?? 0;
  const cacheCreateIn = u.cacheCreationInputTokens ?? 0;
  const cacheCreate1hIn = Math.min(u.cacheCreation1hInputTokens ?? 0, cacheCreateIn);
  const promptTokens = u.inputTokens + cachedIn + cacheCreateIn;
  const lc = cost.longContext;
  const mult = lc && promptTokens > lc.thresholdTokens ? lc.multiplier : 1;
  let usd = mult * (
    (u.inputTokens / 1e6) * cost.usdPerMTokInput + (cachedIn / 1e6) * cachedRate +
    ((cacheCreateIn - cacheCreate1hIn) / 1e6) * cacheWriteRate + (cacheCreate1hIn / 1e6) * cacheWrite1hRate +
    (u.outputTokens / 1e6) * cost.usdPerMTokOutput);
  if (u.audioInputSeconds && cost.usdPerSecondAudio) {
    usd += Math.max(u.audioInputSeconds, cost.minBilledSecondsAudio ?? 0) * cost.usdPerSecondAudio;
  }
  return usd;
}

/** Haiku 5.5 na lib: o `longContext ×5` vira uma faixa com as taxas × 5 (spec §15.3). */
const HAIKU = {
  cost: {
    input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite1h: 0.20,
    tiers: [{ aboveInputTokens: 100_000, input: 0.50, output: 2.50, cacheRead: 0.05, cacheWrite: 0.625, cacheWrite1h: 1.00 }],
  },
};
const GROQ_TURBO = { cost: { input: 0, output: 0, audioPerSecond: 0.04 / 3600, minBilledSeconds: 10 } };

// ---- Fonte do custo ----

test('custo do provedor vence a tabela', () => {
  assert.deepEqual(computeCost(HAIKU, usage({ input: 1000, output: 1000 }), 0.0123), { usd: 0.0123, source: 'provider' });
});

test('custo do provedor 0 é zero de verdade, não ausência', () => {
  assert.deepEqual(computeCost(HAIKU, usage({ input: 1000 }), 0), { usd: 0, source: 'provider' });
  assert.deepEqual(computeCost({}, usage({ input: 1000 }), 0), { usd: 0, source: 'provider' });
});

test('custo do provedor ilegível (negativo, NaN, null) cai na tabela', () => {
  const u = usage({ input: 1_000_000 });
  for (const bad of [-1, NaN, Infinity, null, undefined]) {
    assert.deepEqual(computeCost({ cost: { input: 2, output: 0 } }, u, bad), { usd: 2, source: 'table' }, String(bad));
  }
});

test('sem model.cost: usd null, source none (nunca valor inventado)', () => {
  assert.deepEqual(computeCost({}, usage({ input: 1000, output: 1000 })), { usd: null, source: 'none' });
  assert.deepEqual(computeCost({ cost: undefined }, usage({ input: 1 })), { usd: null, source: 'none' });
  // cost sem input/output numéricos não é tabela utilizável
  assert.deepEqual(computeCost(/** @type {any} */ ({ cost: { input: 1 } }), usage({ input: 1 })), { usd: null, source: 'none' });
});

// ---- Tabela simples e cache ----

test('tabela simples: input e output por milhão', () => {
  const r = computeCost({ cost: { input: 3, output: 15 } }, usage({ input: 2000, output: 500 }));
  assert.equal(r.source, 'table');
  close(r.usd, (2000 * 3 + 500 * 15) / 1e6);
});

test('cache lido e gravado (5 min e 1 h) são cobrados à parte', () => {
  const cost = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 };
  const r = computeCost({ cost }, usage({ input: 1000, output: 100, cacheRead: 10_000, cacheWrite: 2000, cacheWrite1h: 3000 }));
  close(r.usd, (1000 * 1 + 100 * 5 + 10_000 * 0.1 + 2000 * 1.25 + 3000 * 2) / 1e6);
});

test('cache sem preço sai ao preço de input (spec §15.4)', () => {
  const r = computeCost({ cost: { input: 2, output: 8 } }, usage({ input: 1000, output: 100, cacheRead: 4000, cacheWrite: 500, cacheWrite1h: 500 }));
  close(r.usd, (1000 * 2 + 100 * 8 + 4000 * 2 + 500 * 2 + 500 * 2) / 1e6);
  // só o que falta cai no input: cacheRead declarado, escritas não
  const parcial = computeCost({ cost: { input: 2, output: 8, cacheRead: 0.2 } }, usage({ cacheRead: 1_000_000, cacheWrite: 1_000_000 }));
  close(parcial.usd, 0.2 + 2);
});

// ---- Faixa de contexto longo: Haiku 5.5 do Gateway ----

test('Haiku 5.5 abaixo do limite bate com computeCredits do Gateway', () => {
  // Gateway: cacheCreation 15_000 inclui 5_000 de 1 h → lib: 10_000 de 5 min + 5_000 de 1 h.
  const gw = { inputTokens: 50_000, outputTokens: 2000, cachedInputTokens: 30_000, cacheCreationInputTokens: 15_000, cacheCreation1hInputTokens: 5000 };
  const lib = usage({ input: 50_000, output: 2000, cacheRead: 30_000, cacheWrite: 10_000, cacheWrite1h: 5000 });
  assert.equal(gw.inputTokens + gw.cachedInputTokens + gw.cacheCreationInputTokens, 95_000);
  assert.equal(tierFor(HAIKU.cost, 95_000), null);
  const r = computeCost(HAIKU, lib);
  assert.equal(r.source, 'table');
  close(r.usd, 0.00855, 'valor à mão');
  close(r.usd, gatewayUsd(HAIKU_GATEWAY, gw), 'contra o Gateway');
});

test('Haiku 5.5 acima do limite: todas as taxas × 5, igual ao Gateway', () => {
  // Gateway: cacheCreation 12_000 inclui 4_000 de 1 h → lib: 8_000 de 5 min + 4_000 de 1 h. Prompt = 102_000.
  const gw = { inputTokens: 60_000, outputTokens: 3000, cachedInputTokens: 30_000, cacheCreationInputTokens: 12_000, cacheCreation1hInputTokens: 4000 };
  const lib = usage({ input: 60_000, output: 3000, cacheRead: 30_000, cacheWrite: 8000, cacheWrite1h: 4000 });
  assert.equal(gw.inputTokens + gw.cachedInputTokens + gw.cacheCreationInputTokens, 102_000);
  assert.equal(tierFor(HAIKU.cost, 102_000)?.aboveInputTokens, 100_000);
  const r = computeCost(HAIKU, lib);
  close(r.usd, 0.048, 'valor à mão (5 × 0,0096)');
  close(r.usd, gatewayUsd(HAIKU_GATEWAY, gw), 'contra o Gateway');
});

test('o limite é "passa de": exatamente 100.000 fica na taxa base; 100.001 sobe', () => {
  const at = computeCost(HAIKU, usage({ input: 100_000, output: 1000 }));
  close(at.usd, (100_000 * 0.10 + 1000 * 0.50) / 1e6);
  const over = computeCost(HAIKU, usage({ input: 100_001, output: 1000 }));
  close(over.usd, (100_001 * 0.50 + 1000 * 2.50) / 1e6);
  // o prompt total soma input + cacheRead + cacheWrite + cacheWrite1h
  const split = computeCost(HAIKU, usage({ input: 25_000, cacheRead: 25_000, cacheWrite: 25_000, cacheWrite1h: 25_000 }));
  close(split.usd, (25_000 * 0.10 + 25_000 * 0.01 + 25_000 * 0.125 + 25_000 * 0.20) / 1e6, 'no limite');
  const split1 = computeCost(HAIKU, usage({ input: 25_000, cacheRead: 25_000, cacheWrite: 25_000, cacheWrite1h: 25_001 }));
  close(split1.usd, (25_000 * 0.50 + 25_000 * 0.05 + 25_000 * 0.625 + 25_001 * 1.00) / 1e6, 'passou por 1 token do 1h');
});

test('faixa substitui só as taxas que declara; o resto fica a base; várias faixas pegam a maior que vale', () => {
  // `CostTier` em types.js exige input e output; o código (e a spec §15.3) aceitam faixa parcial.
  const cost = /** @type {any} */ ({
    input: 1, output: 2, cacheRead: 0.1,
    tiers: [{ aboveInputTokens: 200_000, input: 4 }, { aboveInputTokens: 100_000, input: 2, output: 3 }],
  });
  assert.equal(tierFor(cost, 50_000), null);
  close(computeCost({ cost }, usage({ input: 150_000, output: 1000, cacheRead: 1000 })).usd, (150_000 * 2 + 1000 * 3 + 1000 * 0.1) / 1e6);
  // acima de 200k: input 4, output da base (a faixa de 200k não declara) 2
  close(computeCost({ cost }, usage({ input: 250_000, output: 1000 })).usd, (250_000 * 4 + 1000 * 2) / 1e6);
});

// ---- Áudio por segundo com mínimo (Groq whisper) ----

test('áudio por segundo: abaixo do mínimo cobra o mínimo (3 s → 10 s)', () => {
  const gw = { inputTokens: 0, outputTokens: 0, audioInputSeconds: 3 };
  const r = computeCost(GROQ_TURBO, usage({ audioSeconds: 3 }));
  close(r.usd, 10 * 0.04 / 3600);
  close(r.usd, gatewayUsd(GROQ_TURBO_GATEWAY, gw), 'contra o Gateway');
});

test('áudio por segundo: acima do mínimo cobra os segundos reais (15 s)', () => {
  const gw = { inputTokens: 0, outputTokens: 0, audioInputSeconds: 15 };
  const r = computeCost(GROQ_TURBO, usage({ audioSeconds: 15 }));
  close(r.usd, 15 * 0.04 / 3600);
  close(r.usd, gatewayUsd(GROQ_TURBO_GATEWAY, gw), 'contra o Gateway');
});

test('áudio: sem segundos não cobra o mínimo; sem audioPerSecond ignora os segundos; sem minBilledSeconds cobra o real', () => {
  close(computeCost(GROQ_TURBO, usage({})).usd, 0);
  close(computeCost({ cost: { input: 1, output: 1 } }, usage({ audioSeconds: 30 })).usd, 0);
  close(computeCost({ cost: { input: 0, output: 0, audioPerSecond: 0.001 } }, usage({ audioSeconds: 3 })).usd, 0.003);
});

test('áudio soma com tokens (modelo que cobra os dois)', () => {
  const r = computeCost({ cost: { input: 1, output: 1, audioPerSecond: 0.01 } }, usage({ input: 1_000_000, audioSeconds: 2 }));
  close(r.usd, 1 + 0.02);
});

// ---- Uso inválido ----

test('valores negativos, NaN, Infinity e não-número no usage contam como 0', () => {
  const cost = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, cacheWrite1h: 1, audioPerSecond: 1 };
  const bad = /** @type {any} */ ({ input: -5, output: NaN, cacheRead: Infinity, cacheWrite: '10', cacheWrite1h: null, audioSeconds: -3 });
  assert.deepEqual(computeCost({ cost }, bad), { usd: 0, source: 'table' });
  // o valor válido ao lado do inválido continua contando
  close(computeCost({ cost }, /** @type {any} */ ({ input: -5, output: 1_000_000 })).usd, 1);
  assert.deepEqual(computeCost({ cost }, /** @type {any} */ (undefined)), { usd: 0, source: 'table' });
});

test('valor negativo não derruba o prompt abaixo do limite da faixa', () => {
  // input -1000 conta 0 (não subtrai): 100_001 de cacheRead sozinho passa do limite.
  const r = computeCost(HAIKU, usage({ input: -1000, cacheRead: 100_001 }));
  close(r.usd, 100_001 * 0.05 / 1e6);
});

test('uso não declarado não vira US$ 0 (C1)', () => {
  const r = computeCost({ cost: { input: 1, output: 2 } }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, missing: true });
  assert.deepEqual(r, { usd: null, source: 'none' });
  // o custo do provedor ainda vence
  assert.deepEqual(computeCost({ cost: { input: 1, output: 2 } }, { missing: true }, 0.01), { usd: 0.01, source: 'provider' });
});

test('armazenamento de cache soma fora das faixas, só na tabela', () => {
  const cost = { input: 1, output: 1, cacheStoragePerMTokHour: 2, tiers: [{ aboveInputTokens: 0, input: 10, output: 10 }] };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, cacheStorageTokenHours: 1_000_000 };
  assert.deepEqual(computeCost({ cost }, usage), { usd: 2, source: 'table' });
  assert.deepEqual(computeCost({ cost }, usage, 0.5), { usd: 0.5, source: 'provider' });
});
