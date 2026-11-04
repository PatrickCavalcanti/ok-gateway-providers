export function buildRequest(args: {
    account: import("../types.js").Account;
    model: import("../types.js").Model;
    compat: import("../types.js").ResolvedCompat;
    request: import("../types.js").ChatRequest;
    apiKey: string;
}): {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
};
/**
 * Mensagens da lib → `contents` do Gemini. Exportada: quem monta `cachedContents` por fora
 * (o snapshot do histórico) converte com a mesma função que o pedido usa.
 *
 * - `assistant` vira `model`, com `functionCall` para cada tool call.
 * - `tool` vira `functionResponse`; o `name` vem de `toolName` ou da chamada anterior de mesmo `toolCallId`.
 *   Resultados seguidos viram um turno só, como o Gemini pede para chamadas paralelas.
 * - A conversão olha só as mensagens que recebe: resultado de tool cuja chamada ficou fora da
 *   lista e sem `toolName` dá `invalid_request`.
 * @param {Message[]} messages
 * @param {{ model: Model, provider?: string }} ctx
 * @returns {GeminiContent[]}
 */
export function toGeminiContents(messages: Message[], { model, provider }: {
    model: Model;
    provider?: string;
}): GeminiContent[];
export function parseStream(events: AsyncIterable<import("../sse.js").SSEEvent>, ctx: {
    account: import("../types.js").Account;
    model: import("../types.js").Model;
    compat: import("../types.js").ResolvedCompat;
    headers: Headers;
}): AsyncGenerator<Exclude<import("../types.js").ChatEvent, {
    type: "end";
}>, import("../types.js").StreamSummary, undefined>;
/** @typedef {import('../types.js').ApiModule} ApiModule */
/** @typedef {import('../types.js').Message} Message */
/** @typedef {import('../types.js').Part} Part */
/** @typedef {import('../types.js').Model} Model */
/** @typedef {{ provider: string, model: string }} Ctx */
/** @typedef {{ role: string, parts: Record<string, any>[] }} GeminiContent */
export const api: "google-generative-ai";
export type ApiModule = import("../types.js").ApiModule;
export type Message = import("../types.js").Message;
export type Part = import("../types.js").Part;
export type Model = import("../types.js").Model;
export type Ctx = {
    provider: string;
    model: string;
};
export type GeminiContent = {
    role: string;
    parts: Record<string, any>[];
};
