import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCreditConverter } from '../src/credits.js';

// Conversão do Gateway de hoje (igris-gateway/src/credits/pricing.ts):
// USD_TO_BRL 5.5 / CREDIT_VALUE_BRL 0.001, arredondado em 6 casas.
const gatewayCredits = (/** @type {number} */ usd) => Math.round((usd * 5.5) / 0.001 * 1e6) / 1e6;

test('null e undefined continuam null', () => {
  const c = createCreditConverter({ creditsPerUsd: 5500 });
  assert.equal(c.toCredits(null), null);
  assert.equal(c.toCredits(undefined), null);
  assert.equal(c.toCredits(NaN), null);
  assert.equal(c.toCredits(Infinity), null);
});

test('expõe creditsPerUsd', () => {
  assert.equal(createCreditConverter({ creditsPerUsd: 5500 }).creditsPerUsd, 5500);
});

test('config do Gateway reproduz o arredondamento dele', () => {
  const c = createCreditConverter({ creditsPerUsd: 5500, rounding: 'round', decimals: 6 });
  for (const usd of [0, 0.00855, 0.048, 0.000111, 0.1, 1.234567, 3.3333333, 0.0000004, 0.0000005, 12.5, 100]) {
    assert.equal(c.toCredits(usd), gatewayCredits(usd), `usd ${usd}`);
  }
  assert.equal(c.toCredits(0.048), 264);
  assert.equal(c.toCredits(0.00855), 47.025);
});

test('empate decimal exato: a lib arredonda para cima (o Gateway, por ruído de float, pode descer)', () => {
  const c = createCreditConverter({ creditsPerUsd: 5500, rounding: 'round', decimals: 6 });
  // 0.000111111 USD × 5500 = 0.6111105 exato: o sétimo decimal é 5.
  assert.equal(c.toCredits(0.000111111), 0.611111);
  assert.equal(gatewayCredits(0.000111111), 0.61111);
});

test('config do Gateway: pseudoaleatório determinístico bate com a fórmula dele (até ~US$ 150)', () => {
  const c = createCreditConverter({ creditsPerUsd: 5500, rounding: 'round', decimals: 6 });
  let seed = 42;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 5000; i++) {
    const usd = Math.round(rnd() * 10 ** (Math.floor(rnd() * 6) - 4) * 1e6) / 1e6 * 1.37;
    assert.equal(c.toCredits(usd), gatewayCredits(usd), `usd ${usd}`);
  }
});

test('ceil sem ruído de ponto flutuante', () => {
  const c = createCreditConverter({ creditsPerUsd: 5500, rounding: 'ceil' });
  assert.ok(0.07 * 5500 > 385, 'premissa: o produto cru tem ruído (385.00000000000006) e daria 386 num ceil ingênuo');
  assert.equal(Math.ceil(0.07 * 5500), 386);
  assert.equal(c.toCredits(0.07), 385);
  assert.equal(c.toCredits(0.042), 231);
  assert.equal(c.toCredits(0.1), 550);
  assert.equal(c.toCredits(0.3), 1650);
  assert.equal(c.toCredits(0.0001), 1); // 0.55 → 1
  assert.equal(c.toCredits(0.000182), 2); // 1.001 → 2
  assert.equal(c.toCredits(0), 0);
});

test('ceil com casas decimais', () => {
  const c = createCreditConverter({ creditsPerUsd: 5500, rounding: 'ceil', decimals: 2 });
  assert.equal(c.toCredits(0.000182), 1.01); // 1.001 → 1.01
  assert.equal(c.toCredits(0.1), 550);
});

test('round e decimals padrão (0)', () => {
  const c = createCreditConverter({ creditsPerUsd: 1000 });
  assert.equal(c.toCredits(0.0004), 0); // 0.4 → 0
  assert.equal(c.toCredits(0.0005), 1); // 0.5 → 1
  assert.equal(c.toCredits(1.2345), 1235); // 1234.5 → 1235 (round ingênuo daria 1234 por ruído)
});

test('none devolve o produto, sem arredondar', () => {
  const c = createCreditConverter({ creditsPerUsd: 5500, rounding: 'none' });
  assert.equal(c.toCredits(0.00855), 0.00855 * 5500);
  assert.equal(c.toCredits(0), 0);
  assert.equal(c.toCredits(null), null);
});

test('parâmetros inválidos lançam TypeError', () => {
  for (const creditsPerUsd of [0, -1, NaN, Infinity, '5500', null, undefined]) {
    assert.throws(() => createCreditConverter(/** @type {any} */ ({ creditsPerUsd })), TypeError, `creditsPerUsd ${creditsPerUsd}`);
  }
  assert.throws(() => createCreditConverter({ creditsPerUsd: 5500, rounding: /** @type {any} */ ('floor') }), TypeError);
  for (const decimals of [-1, 1.5, 13, NaN, /** @type {any} */ ('2')]) {
    assert.throws(() => createCreditConverter({ creditsPerUsd: 5500, decimals }), TypeError, `decimals ${decimals}`);
  }
});
