/**
 * `mime` → `format` curto usado por `input_audio`/`input_video` (`video/quicktime` → `mov`).
 * @param {string} mime
 */
export function mediaFormat(mime: string): string;
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
export function assertMediaSupported(part: Part, model: Pick<Model, "id" | "input" | "transport">, ctx?: {
    provider?: string;
}): void;
/**
 * Converte `Message.content` (string ou `Part[]`) em partes do formato Chat Completions.
 * Texto com `cache` e `compat.cacheMarker === 'cache_control'` leva `cache_control`;
 * com outro `cacheMarker` a marca é só uma dica e fica de fora (não é mídia).
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
export type Part = import("./types.js").Part;
export type Model = import("./types.js").Model;
export type ResolvedCompat = import("./types.js").ResolvedCompat;
