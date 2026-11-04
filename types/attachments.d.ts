/**
 * `mime` → `format` curto usado por `input_audio`/`input_video` (`video/quicktime` → `mov`).
 * @param {string} mime
 */
export function mediaFormat(mime: string): string;
/**
 * Separa um data-url: `data:<mime>[;param]*[;base64],<dados>`. `null` quando não é data-url.
 * `mime` vem sem parâmetros e fica `undefined` se o prefixo não o traz. Sem vírgula, `data` é vazio.
 * @param {string} raw
 * @returns {{ mime: string|undefined, base64: boolean, data: string } | null}
 */
export function parseDataUrl(raw: string): {
    mime: string | undefined;
    base64: boolean;
    data: string;
} | null;
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
export function assertMediaSupported(part: Part, model: Pick<Model, "id" | "input" | "transport">, ctx?: {
    provider?: string;
}): asserts part is Exclude<Part, {
    type: "reasoning";
}>;
/** Nome para arquivo sem `name` (o Chat Completions pede `filename`). @param {string|undefined} mime */
export function defaultFilename(mime: string | undefined): string;
/**
 * Campos de marca de cache de um bloco de texto, conforme o `cacheMarker` do compat.
 * Vazio quando não há marca pedida ou o compat não a aceita.
 * @param {{ ttl?: string }|undefined} cache
 * @param {string|undefined} cacheMarker
 * @returns {Record<string, unknown>}
 */
export function cacheFields(cache: {
    ttl?: string;
} | undefined, cacheMarker: string | undefined): Record<string, unknown>;
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
export function toOpenAIContent(content: string | Part[], { model, compat, provider }: {
    model: Model;
    compat: Pick<ResolvedCompat, "cacheMarker">;
    provider?: string;
}): Record<string, unknown>[];
/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./types.js').Model} Model */
/** @typedef {import('./types.js').ResolvedCompat} ResolvedCompat */
/** Transporte de imagem quando o modelo não declara. */
export const DEFAULT_IMAGE_TRANSPORT: readonly string[];
/** Arquivo (PDF, texto…): só data-url por padrão — é o formato confirmado no Igris. */
export const DEFAULT_FILE_TRANSPORT: readonly string[];
export type Part = import("./types.js").Part;
export type Model = import("./types.js").Model;
export type ResolvedCompat = import("./types.js").ResolvedCompat;
