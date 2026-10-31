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
export function parseStream(events: AsyncIterable<import("../sse.js").SSEEvent>, ctx: {
    account: import("../types.js").Account;
    model: import("../types.js").Model;
    compat: import("../types.js").ResolvedCompat;
}): AsyncGenerator<Exclude<import("../types.js").ChatEvent, {
    type: "end";
}>, import("../types.js").StreamSummary, undefined>;
/** @typedef {import('../types.js').Model} Model */
/** @typedef {import('../types.js').Part} Part */
/** @typedef {import('../types.js').Message} Message */
/** @typedef {import('../types.js').ResolvedCompat} ResolvedCompat */
/** @typedef {import('../types.js').ChatRequest} ChatRequest */
/** @typedef {import('../types.js').CacheMark} CacheMark */
/** @typedef {import('../types.js').Usage} Usage */
/** @typedef {import('../types.js').StreamSummary} StreamSummary */
/** @typedef {import('../sse.js').SSEEvent} SSEEvent */
/** @typedef {Record<string, any>} Block */
/** @typedef {{ provider: string, model: string }} Ctx */
export const api: "anthropic-messages";
export type Model = import("../types.js").Model;
export type Part = import("../types.js").Part;
export type Message = import("../types.js").Message;
export type ResolvedCompat = import("../types.js").ResolvedCompat;
export type ChatRequest = import("../types.js").ChatRequest;
export type CacheMark = import("../types.js").CacheMark;
export type Usage = import("../types.js").Usage;
export type StreamSummary = import("../types.js").StreamSummary;
export type SSEEvent = import("../sse.js").SSEEvent;
export type Block = Record<string, any>;
export type Ctx = {
    provider: string;
    model: string;
};
