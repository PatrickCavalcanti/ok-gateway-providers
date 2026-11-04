// ok-gateway-providers — decisão no formato OpenRouter / TypeSafe.
import { ProviderError, unsupported } from '../../errors.js';
import { makeUsage, num, reportedCost } from '../../usage.js';

const PROTECTED = new Set(['model', 'state', 'questions']);
const isObject = (/** @type {unknown} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** @type {import('../../types.js').OperationModule} */
export const decision = {
  buildRequest({ account, model, compat, request, apiKey }) {
    const ctx = { provider: account.provider, model: model.id };
    if (!compat.decisionPath) throw unsupported(`${ctx.provider}/${ctx.model}: a conta não declara compat.decisionPath`, ctx);
    if (!isObject(request.state) || !isObject(request.questions) || Object.keys(request.questions).length === 0) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, message: `${ctx.provider}/${ctx.model}: state e questions precisam ser objetos, e questions não pode ser vazio` });
    }
    /** @type {Record<string, unknown>} */
    const body = {};
    for (const layer of [model.params, request.params]) {
      for (const [k, v] of Object.entries(layer ?? {})) if (!PROTECTED.has(k) && v !== undefined) body[k] = v;
    }
    body.model = model.id;
    body.state = request.state;
    body.questions = request.questions;
    return {
      // Resolvido contra a base: `../alpha/decisions` sai de /api/v1 para /api/alpha/decisions.
      url: new URL(compat.decisionPath, `${account.baseUrl.replace(/\/+$/, '')}/`).href,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body,
    };
  },
  async parseResponse(res, { account, model }) {
    const json = await res.json();
    if (!isObject(json?.answers) || Object.keys(json.answers).length === 0) {
      throw new ProviderError({ type: 'upstream', provider: account.provider, model: model.id, body: json, message: `${account.provider}/${model.id}: decisão sem answers` });
    }
    const u = json.usage ?? {};
    const usage = makeUsage({ input: num(u.input_tokens), output: num(u.output_tokens), raw: json.usage });
    return { result: { answers: json.answers }, usage, reportedCostUsd: reportedCost(u.cost) };
  },
};
