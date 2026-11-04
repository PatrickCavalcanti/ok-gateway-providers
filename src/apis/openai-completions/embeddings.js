// ok-gateway-providers — embeddings no formato OpenAI.
import { ProviderError } from '../../errors.js';
import { makeUsage, num, reportedCost } from '../../usage.js';
import { applyParams } from '../../params.js';

const PROTECTED = new Set(['model', 'input']);

/** @type {import('../../types.js').OperationModule} */
export const embeddings = {
  buildRequest({ account, model, request, apiKey }) {
    if (!Array.isArray(request.texts) || request.texts.length === 0 || request.texts.some((/** @type {unknown} */ t) => typeof t !== 'string')) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, provider: account.provider, model: model.id, message: `${account.provider}/${model.id}: texts precisa ser uma lista de textos` });
    }
    /** @type {Record<string, unknown>} */
    const body = { model: model.id, input: request.texts };
    applyParams(body, [model.params, request.params], (k) => PROTECTED.has(k));
    // Campo de controle do pedido, depois dos params: o explícito vence.
    if (request.dimensions !== undefined) body.dimensions = request.dimensions;
    return {
      url: `${account.baseUrl.replace(/\/+$/, '')}/embeddings`,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body,
    };
  },
  async parseResponse(res, { account, model, request }) {
    const json = await res.json();
    const items = Array.isArray(json?.data) ? [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
    const indexes = items.map((i) => i.index).filter((i) => i !== undefined);
    const invalid = items.some((i) => !Array.isArray(i.embedding) || i.embedding.length === 0 || typeof i.embedding[0] !== 'number');
    if (items.length !== request.texts.length || invalid || new Set(indexes).size !== indexes.length) {
      throw new ProviderError({ type: 'upstream', provider: account.provider, model: model.id, body: json, message: `${account.provider}/${model.id}: resposta com ${items.length} vetor(es) para ${request.texts.length} texto(s)` });
    }
    const u = json.usage ?? {};
    const cached = num(u.prompt_tokens_details?.cached_tokens);
    const usage = makeUsage({ input: Math.max(0, num(u.prompt_tokens) - cached), cacheRead: cached, raw: json.usage });
    return { result: { vectors: items.map((i) => i.embedding) }, usage, reportedCostUsd: reportedCost(u.cost) };
  },
};
