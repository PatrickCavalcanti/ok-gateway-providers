// ok-gateway-providers — transcrição no formato OpenAI (OpenAI, Groq).
import { ProviderError } from '../../errors.js';
import { mediaFormat } from '../../attachments.js';
import { makeUsage, num, reportedCost } from '../../usage.js';

const PROTECTED = new Set(['model', 'file', 'response_format', 'language', 'prompt']);

/** @param {any} json */
function durationOf(json) {
  if (typeof json?.duration === 'number' && Number.isFinite(json.duration)) return json.duration;
  /** @type {any[]} */
  const segments = Array.isArray(json?.segments) ? json.segments : [];
  const ends = segments.map((s) => s?.end).filter((e) => typeof e === 'number');
  return ends.length ? Math.max(...ends) : undefined;
}

/** @type {import('../../types.js').OperationModule} */
export const transcription = {
  buildRequest({ account, model, compat, request, apiKey }) {
    const ctx = { provider: account.provider, model: model.id };
    if (!(request.audio instanceof Uint8Array) || request.audio.length === 0) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, message: `${ctx.provider}/${ctx.model}: audio precisa ser Uint8Array não vazio` });
    }
    if (!request.mime) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, message: `${ctx.provider}/${ctx.model}: audio precisa de mime` });
    }
    const form = new FormData();
    form.append('file', new Blob([request.audio], { type: request.mime }), request.filename ?? `audio.${mediaFormat(request.mime)}`);
    form.append('model', model.id);
    form.append('response_format', compat.sttResponseFormat);
    if (request.language) form.append('language', request.language);
    if (request.prompt) form.append('prompt', request.prompt);
    for (const layer of [model.params, request.params]) {
      for (const [k, v] of Object.entries(layer ?? {})) if (!PROTECTED.has(k) && v !== undefined) form.append(k, String(v));
    }
    /** @type {Record<string, string>} */
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    return {
      url: `${account.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`,
      headers,
      body: form,
    };
  },
  async parseResponse(res, { account, model }) {
    const json = await res.json();
    if (typeof json?.text !== 'string') {
      throw new ProviderError({ type: 'upstream', provider: account.provider, model: model.id, body: json, message: `${account.provider}/${model.id}: transcrição sem text` });
    }
    const durationSeconds = durationOf(json);
    const u = json.usage ?? {};
    const usage = makeUsage({
      input: num(u.input_tokens), output: num(u.output_tokens),
      ...(durationSeconds !== undefined ? { audioSeconds: durationSeconds } : {}),
      raw: json.usage ?? json.x_groq,
    });
    return {
      result: { text: json.text, ...(durationSeconds !== undefined ? { durationSeconds } : {}) },
      usage,
      reportedCostUsd: reportedCost(u.cost),
    };
  },
};
