// ok-gateway-providers — imagem no formato OpenAI.
import { ProviderError } from '../../errors.js';
import { makeUsage, num, reportedCost } from '../../usage.js';

const PROTECTED = new Set(['model', 'prompt', 'response_format']);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Base64 canônico (como o do Gateway): tamanho múltiplo de 4, só o alfabeto e sem bits sobrando no fim. @param {string} value */
function isCanonicalBase64(value) {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

/** @type {import('../../types.js').OperationModule} */
export const imageGeneration = {
  buildRequest({ account, model, compat, request, apiKey }) {
    if (typeof request.prompt !== 'string' || !request.prompt) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, provider: account.provider, model: model.id, message: `${account.provider}/${model.id}: prompt é obrigatório` });
    }
    /** @type {Record<string, unknown>} */
    const body = {};
    for (const layer of [model.params, request.params]) {
      for (const [k, v] of Object.entries(layer ?? {})) if (!PROTECTED.has(k) && v !== undefined) body[k] = v;
    }
    body.model = model.id;
    body.prompt = request.prompt;
    if (compat.imageResponseFormat) body.response_format = compat.imageResponseFormat;
    return {
      url: `${account.baseUrl.replace(/\/+$/, '')}${compat.imagePath}`,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body,
    };
  },
  async parseResponse(res, { account, model, request }) {
    const json = await res.json();
    const fail = (/** @type {string} */ message) => new ProviderError({ type: 'upstream', provider: account.provider, model: model.id, body: json, message: `${account.provider}/${model.id}: ${message}` });
    const data = Array.isArray(json?.data) ? json.data : [];
    if (data.length === 0) throw fail('resposta de imagem sem data');
    const n = request.params?.n ?? model.params?.n;
    if (typeof n === 'number' && data.length !== n) throw fail(`pedidas ${n} imagens, vieram ${data.length}`);
    const images = data.map((/** @type {any} */ item) => {
      const b64 = item?.b64_json;
      if (typeof b64 !== 'string' || !isCanonicalBase64(b64)) throw fail('imagem com base64 inválido');
      // `media_type` vazio ou só espaço não diz nada: cai no padrão.
      const mediaType = typeof item.media_type === 'string' && item.media_type.trim() ? item.media_type : 'image/png';
      return { base64: b64, mediaType };
    });
    const u = json.usage ?? {};
    const usage = makeUsage({ input: num(u.prompt_tokens), output: num(u.completion_tokens), raw: json.usage });
    return { result: { images }, usage, reportedCostUsd: reportedCost(u.cost) };
  },
};
