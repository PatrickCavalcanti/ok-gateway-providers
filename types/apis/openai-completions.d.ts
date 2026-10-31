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
 * `usage` do chunk → Usage normalizado. `input` sai sem o cache lido nem gravado.
 * @param {any} u
 * @returns {Usage}
 */
export function normalizeUsage(u: any): Usage;
export function parseStream(events: AsyncIterable<import("../sse.js").SSEEvent>, ctx: {
    account: import("../types.js").Account;
    model: import("../types.js").Model;
    compat: import("../types.js").ResolvedCompat;
}): AsyncGenerator<Exclude<import("../types.js").ChatEvent, {
    type: "end";
}>, import("../types.js").StreamSummary, undefined>;
/** @typedef {import('../types.js').ApiModule} ApiModule */
/** @typedef {import('../types.js').Message} Message */
/** @typedef {import('../types.js').Part} Part */
/** @typedef {import('../types.js').Usage} Usage */
export const api: "openai-completions";
export type ApiModule = import("../types.js").ApiModule;
export type Message = import("../types.js").Message;
export type Part = import("../types.js").Part;
export type Usage = import("../types.js").Usage;
