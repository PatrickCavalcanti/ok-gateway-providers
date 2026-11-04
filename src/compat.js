// ok-gateway-providers — compat declarado (spec §6).
//
// Cada campo substitui um `if` por provedor. Ordem: padrão do fio ← conta ← modelo,
// campo a campo; `headers` faz merge. A conta genérica nasce conservadora.

/** @typedef {import('./types.js').Compat} Compat */
/** @typedef {import('./types.js').ResolvedCompat} ResolvedCompat */

/** @type {ResolvedCompat} */
const BASE = Object.freeze({
  maxTokensField: 'max_tokens',
  supportsDeveloperRole: false,
  supportsStore: false,
  supportsTemperature: true,
  reasoningFormat: 'none',
  thinkingByDefault: false,
  structuredOutput: 'none',
  usageInStream: false,
  providerRouting: false,
  cacheMarker: 'none',
  sttResponseFormat: 'json',
  ttsDefaultVoice: null,
  ttsDefaultFormat: null,
  imagePath: '/images/generations',
  imageResponseFormat: 'b64_json',
  decisionPath: null,
  headers: Object.freeze({}),
});

/** @type {Readonly<Record<string, ResolvedCompat>>} */
export const DEFAULT_COMPAT = Object.freeze({
  'openai-completions': BASE,
  'anthropic-messages': Object.freeze({
    ...BASE,
    reasoningFormat: 'anthropic_thinking',
    structuredOutput: 'output_config',
    usageInStream: true,
    cacheMarker: 'cache_control',
  }),
  'google-generative-ai': Object.freeze({ ...BASE, structuredOutput: 'response_json_schema', usageInStream: true }),
});

/**
 * @param {{ api: string, compat?: Compat, headers?: Record<string, string> }} account
 * @param {{ compat?: Compat }} [model]
 * @returns {ResolvedCompat}
 */
export function resolveCompat(account, model = {}) {
  const base = DEFAULT_COMPAT[account.api] ?? BASE;
  /** @type {Record<string, unknown>} */
  const out = { ...base };
  for (const layer of [account.compat, model.compat]) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined || k === 'headers') continue;
      out[k] = v;
    }
  }
  out.headers = { ...base.headers, ...(account.compat?.headers ?? {}), ...(model.compat?.headers ?? {}) };
  return /** @type {ResolvedCompat} */ (out);
}
