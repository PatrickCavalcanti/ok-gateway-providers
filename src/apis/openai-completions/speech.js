// ok-gateway-providers — fala no formato OpenAI. `usage.input` = caracteres; `cost.input` = US$ por milhão de caracteres.
import { ProviderError } from '../../errors.js';
import { makeUsage } from '../../usage.js';

const PROTECTED = new Set(['model', 'input', 'voice', 'response_format']);

/** @type {Record<string, string>} */
const CONTENT_TYPE = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/opus', aac: 'audio/aac', flac: 'audio/flac', pcm: 'audio/pcm' };

/** @type {import('../../types.js').OperationModule} */
export const speech = {
  buildRequest({ account, model, compat, request, apiKey }) {
    if (typeof request.text !== 'string' || !request.text) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, provider: account.provider, model: model.id, message: `${account.provider}/${model.id}: text é obrigatório` });
    }
    /** @type {Record<string, unknown>} */
    const body = {};
    for (const layer of [model.params, request.params]) {
      for (const [k, v] of Object.entries(layer ?? {})) if (!PROTECTED.has(k) && v !== undefined) body[k] = v;
    }
    body.model = model.id;
    body.input = request.text;
    const voice = request.voice ?? compat.ttsDefaultVoice;
    const format = request.format ?? compat.ttsDefaultFormat;
    if (voice) body.voice = voice;
    if (format) body.response_format = format;
    if (request.instructions) body.instructions = request.instructions;
    if (request.speed !== undefined) body.speed = request.speed;
    return {
      url: `${account.baseUrl.replace(/\/+$/, '')}/audio/speech`,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body,
    };
  },
  async parseResponse(res, { account, model, compat, request }) {
    const audio = await res.bytes();
    if (audio.length === 0) {
      throw new ProviderError({ type: 'upstream', provider: account.provider, model: model.id, message: `${account.provider}/${model.id}: resposta de fala vazia` });
    }
    const header = res.headers.get('content-type');
    const format = request.format ?? compat.ttsDefaultFormat;
    const contentType = header?.toLowerCase().startsWith('audio/') ? header : (CONTENT_TYPE[format] ?? 'application/octet-stream');
    const generationId = res.headers.get('x-generation-id');
    const usage = makeUsage({ input: request.text.length, ...(generationId ? { raw: { generationId } } : {}) });
    return { result: { audio, contentType }, usage, reportedCostUsd: null };
  },
};
