// ok-gateway-providers — anexos: Part[] → partes do transporte (spec §7).
//
// Regra única: mídia que o modelo não declara em `input`, ou que o transporte do modelo
// não cobre, vira `unsupported` ANTES do fetch. Nada é descartado em silêncio. Baixar uma
// URL para transformá-la em data-url é papel do cliente, não da lib.

import { ProviderError, unsupported } from './errors.js';

/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./types.js').Model} Model */
/** @typedef {import('./types.js').ResolvedCompat} ResolvedCompat */

/** Transporte de imagem quando o modelo não declara. */
export const DEFAULT_IMAGE_TRANSPORT = Object.freeze(['data-url', 'url']);

/**
 * `mime` → `format` curto usado por `input_audio`/`input_video` (`video/quicktime` → `mov`).
 * @param {string} mime
 */
export function mediaFormat(mime) {
  const subtype = (mime.split('/')[1] ?? mime).split(';')[0].trim().replace(/^x-/, '');
  /** @type {Record<string, string>} */
  const alias = { msvideo: 'avi', quicktime: 'mov', matroska: 'mkv', mpeg: 'mp3', wave: 'wav' };
  return alias[subtype] ?? subtype;
}

/** @param {{ provider?: string }} ctx @param {Model} model @param {string} message */
function invalid(ctx, model, message) {
  return new ProviderError({
    type: 'invalid_request', retryOther: false, provider: ctx.provider, model: model.id,
    message: `${ctx.provider ?? 'provider'}/${model.id}: ${message}`,
  });
}

/**
 * Confere se o modelo aceita a parte de mídia. Texto passa direto. Lança
 * `unsupported` (retryOther true) quando `model.input` não declara a modalidade ou
 * quando o transporte não cobre a forma da parte (ex.: URL num modelo só `data-url`).
 * Parte malformada (sem dado nem URL) é `invalid_request` com `retryOther` false.
 * Serve a qualquer fio.
 * @param {Part} part
 * @param {Pick<Model, 'id'|'input'|'transport'>} model
 * @param {{ provider?: string }} [ctx]
 */
export function assertMediaSupported(part, model, ctx = {}) {
  if (part.type === 'text') return;
  const m = /** @type {Model} */ (model);
  const where = `${ctx.provider ?? 'provider'}/${model.id}`;
  const fail = (/** @type {string} */ msg) => unsupported(`${where}: ${msg}`, { provider: ctx.provider, model: model.id });

  if (!Array.isArray(model.input) || !model.input.includes(part.type)) {
    throw fail(`o modelo não aceita ${part.type} na entrada (input: ${(model.input ?? []).join('+') || 'vazio'})`);
  }
  const transport = model.transport ?? {};

  if (part.type === 'image') {
    const allowed = transport.image ?? DEFAULT_IMAGE_TRANSPORT;
    if (part.data === undefined && part.url === undefined) throw invalid(ctx, m, 'parte de imagem sem data nem url');
    if (part.data !== undefined) {
      if (!allowed.includes('data-url')) throw fail('o modelo não aceita imagem em data-url (transport.image)');
      if (!part.data.startsWith('data:') && !part.mime) throw invalid(ctx, m, 'imagem em base64 precisa de mime');
    } else if (!allowed.includes('url')) {
      throw fail('o modelo não aceita imagem por URL (só data-url); baixe a imagem e envie o conteúdo');
    }
    return;
  }

  if (part.type === 'audio') {
    // Sem declaração, o único transporte conhecido é `input_audio`; `null` desliga.
    const t = transport.audio === undefined ? 'input_audio' : transport.audio;
    if (t !== 'input_audio') throw fail('o modelo não aceita áudio no transporte declarado (transport.audio)');
    if (!part.data || !part.format) throw invalid(ctx, m, 'parte de áudio precisa de data (base64) e format');
    return;
  }

  // vídeo: não há transporte padrão — o dono do modelo precisa declarar.
  const t = transport.video;
  if (t !== 'input_video' && t !== 'video_url') {
    throw fail('o modelo não declara transport.video (input_video ou video_url); vídeo não é enviado sem isso');
  }
  if (part.data === undefined && part.url === undefined) throw invalid(ctx, m, 'parte de vídeo sem data nem url');
  if (t === 'input_video') {
    if (part.data === undefined) throw fail('transporte input_video só aceita vídeo em base64 (data), não URL');
    if (!part.mime) throw invalid(ctx, m, 'vídeo em base64 precisa de mime');
  } else if (part.data !== undefined && !part.data.startsWith('data:') && !part.mime) {
    throw invalid(ctx, m, 'vídeo em base64 precisa de mime');
  }
}

/** @param {string} data @param {string|undefined} mime */
const asDataUrl = (data, mime) => (data.startsWith('data:') ? data : `data:${mime};base64,${data}`);

/**
 * Converte `Message.content` (string ou `Part[]`) em partes do formato Chat Completions.
 * Texto com `cache` e `compat.cacheMarker === 'cache_control'` leva `cache_control`;
 * com outro `cacheMarker` a marca é só uma dica e fica de fora (não é mídia).
 * Sempre devolve lista; o chamador decide se colapsa texto puro em string.
 * @param {string | Part[]} content
 * @param {{ model: Model, compat: Pick<ResolvedCompat, 'cacheMarker'>, provider?: string }} ctx
 * @returns {Record<string, unknown>[]}
 */
export function toOpenAIContent(content, { model, compat, provider }) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) throw invalid({ provider }, model, 'content precisa ser string ou lista de partes');
  return content.map((part) => {
    if (part.type === 'text') {
      /** @type {Record<string, unknown>} */
      const out = { type: 'text', text: part.text };
      if (part.cache && compat.cacheMarker === 'cache_control') {
        out.cache_control = part.cache.ttl ? { type: 'ephemeral', ttl: part.cache.ttl } : { type: 'ephemeral' };
      }
      return out;
    }
    assertMediaSupported(part, model, { provider });
    if (part.type === 'image') {
      const url = part.data !== undefined ? asDataUrl(part.data, part.mime) : /** @type {string} */ (part.url);
      return { type: 'image_url', image_url: { url } };
    }
    if (part.type === 'audio') {
      return { type: 'input_audio', input_audio: { data: part.data, format: part.format } };
    }
    // vídeo (assertMediaSupported garantiu transport.video e a forma da parte)
    if (model.transport?.video === 'input_video') {
      return { type: 'input_video', input_video: { data: part.data, format: mediaFormat(/** @type {string} */ (part.mime)) } };
    }
    const url = part.url !== undefined ? part.url : asDataUrl(/** @type {string} */ (part.data), part.mime);
    return { type: 'video_url', video_url: { url } };
  });
}
