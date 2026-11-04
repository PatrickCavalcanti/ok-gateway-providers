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
/** Arquivo (PDF, texto…): só data-url por padrão — é o formato confirmado no Igris. */
export const DEFAULT_FILE_TRANSPORT = Object.freeze(['data-url']);

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

/**
 * Separa um data-url: `data:<mime>[;param]*[;base64],<dados>`. `null` quando não é data-url.
 * `mime` vem sem parâmetros e fica `undefined` se o prefixo não o traz. Sem vírgula, `data` é vazio.
 * @param {string} raw
 * @returns {{ mime: string|undefined, base64: boolean, data: string } | null}
 */
export function parseDataUrl(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('data:')) return null;
  const comma = raw.indexOf(',');
  if (comma === -1) return { mime: undefined, base64: false, data: '' };
  const header = raw.slice(5, comma).split(';').map((h) => h.trim());
  return { mime: header[0] || undefined, base64: header.includes('base64'), data: raw.slice(comma + 1) };
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
 * Serve a qualquer fio. Parte `reasoning` não é mídia nem entrada: só o papel assistant a guarda, e
 * quem a aceita a trata antes de chegar aqui; vinda numa entrada, é `invalid_request`.
 * @param {Part} part
 * @param {Pick<Model, 'id'|'input'|'transport'>} model
 * @param {{ provider?: string }} [ctx]
 * @returns {asserts part is Exclude<Part, { type: 'reasoning' }>}
 */
export function assertMediaSupported(part, model, ctx = {}) {
  if (part.type === 'text') return;
  const m = /** @type {Model} */ (model);
  if (part.type === 'reasoning') throw invalid(ctx, m, 'parte reasoning só existe no papel assistant');
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

  if (part.type === 'file') {
    const allowed = transport.file ?? DEFAULT_FILE_TRANSPORT;
    if (part.data === undefined && part.url === undefined) throw invalid(ctx, m, 'parte de arquivo sem data nem url');
    if (part.data !== undefined) {
      if (!allowed.includes('data-url')) throw fail('o modelo não aceita arquivo em data-url (transport.file)');
      if (!part.data.startsWith('data:') && !part.mime) throw invalid(ctx, m, 'arquivo em base64 precisa de mime');
    } else if (!allowed.includes('url')) {
      throw fail('o modelo não aceita arquivo por URL (só data-url); baixe o arquivo e envie o conteúdo');
    }
    return;
  }

  if (part.type === 'audio') {
    // Sem declaração, o único transporte conhecido é `input_audio`; `null` desliga.
    const t = transport.audio === undefined ? 'input_audio' : transport.audio;
    if (t !== 'input_audio' && t !== 'inline_data') throw fail('o modelo não aceita áudio no transporte declarado (transport.audio)');
    // Em data-url o mime já vem no prefixo, como em imagem e arquivo.
    if (!part.data || (!part.format && !parseDataUrl(part.data)?.mime)) throw invalid(ctx, m, 'parte de áudio precisa de data (base64) e format');
    return;
  }

  // vídeo: não há transporte padrão — o dono do modelo precisa declarar.
  const t = transport.video;
  if (t !== 'input_video' && t !== 'video_url' && t !== 'inline_data') {
    throw fail('o modelo não declara transport.video (input_video, video_url ou inline_data); vídeo não é enviado sem isso');
  }
  if (part.data === undefined && part.url === undefined) throw invalid(ctx, m, 'parte de vídeo sem data nem url');
  if (t === 'input_video' || t === 'inline_data') {
    if (part.data === undefined) throw fail(`transporte ${t} só aceita vídeo em base64 (data), não URL`);
    if (!part.mime && !parseDataUrl(part.data)?.mime) throw invalid(ctx, m, 'vídeo em base64 precisa de mime');
  } else if (part.data !== undefined && !part.data.startsWith('data:') && !part.mime) {
    throw invalid(ctx, m, 'vídeo em base64 precisa de mime');
  }
}

/** Nome para arquivo sem `name` (o Chat Completions pede `filename`). @param {string|undefined} mime */
export function defaultFilename(mime) {
  if (!mime) return 'arquivo';
  const base = mime.split(';')[0].trim().toLowerCase();
  /** @type {Record<string, string>} */
  const ext = {
    'application/pdf': 'pdf', 'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'text/html': 'html',
    'application/json': 'json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  };
  return `arquivo.${ext[base] ?? mediaFormat(base)}`;
}

/** @param {string} data @param {string|undefined} mime */
const asDataUrl = (data, mime) => (data.startsWith('data:') ? data : `data:${mime};base64,${data}`);

/**
 * Campos de marca de cache de um bloco de texto, conforme o `cacheMarker` do compat.
 * Vazio quando não há marca pedida ou o compat não a aceita.
 * @param {{ ttl?: string }|undefined} cache
 * @param {string|undefined} cacheMarker
 * @returns {Record<string, unknown>}
 */
export function cacheFields(cache, cacheMarker) {
  if (!cache) return {};
  if (cacheMarker === 'cache_control') return { cache_control: cache.ttl ? { type: 'ephemeral', ttl: cache.ttl } : { type: 'ephemeral' } };
  if (cacheMarker === 'prompt_cache_breakpoint') return { prompt_cache_breakpoint: { mode: 'explicit' } };
  return {};
}

/**
 * Converte `Message.content` (string ou `Part[]`) em partes do formato Chat Completions.
 * Texto com `cache` leva a marca do `compat.cacheMarker`: `cache_control` (Anthropic-like)
 * ou `prompt_cache_breakpoint` (OpenAI/Gateway); com `none` a marca é só uma dica e fica
 * de fora (não é mídia).
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
      Object.assign(out, cacheFields(part.cache, compat.cacheMarker));
      return out;
    }
    assertMediaSupported(part, model, { provider });
    if (part.type === 'image') {
      const url = part.data !== undefined ? asDataUrl(part.data, part.mime) : /** @type {string} */ (part.url);
      return { type: 'image_url', image_url: { url } };
    }
    if (part.type === 'file') {
      const fileData = part.data !== undefined ? asDataUrl(part.data, part.mime) : /** @type {string} */ (part.url);
      const mime = part.mime ?? /^data:([^;,]+)/.exec(fileData)?.[1];
      return { type: 'file', file: { filename: part.name ?? defaultFilename(mime), file_data: fileData } };
    }
    if (part.type === 'audio') {
      // `input_audio.data` é base64 puro: o data-url perde o prefixo, que fornece o format se faltar.
      const url = parseDataUrl(part.data);
      const format = part.format ?? mediaFormat(/** @type {string} */ (url?.mime));
      return { type: 'input_audio', input_audio: { data: url ? url.data : part.data, format } };
    }
    // vídeo (assertMediaSupported garantiu transport.video e a forma da parte)
    if (model.transport?.video === 'input_video') {
      const url = parseDataUrl(/** @type {string} */ (part.data));
      return { type: 'input_video', input_video: { data: url ? url.data : part.data, format: mediaFormat(/** @type {string} */ (part.mime ?? url?.mime)) } };
    }
    const url = part.url !== undefined ? part.url : asDataUrl(/** @type {string} */ (part.data), part.mime);
    return { type: 'video_url', video_url: { url } };
  });
}
