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
    headers: Headers;
}): AsyncGenerator<Exclude<import("../types.js").ChatEvent, {
    type: "end";
}>, import("../types.js").StreamSummary, undefined>;
/** @typedef {import('../types.js').ApiModule} ApiModule */
/** @typedef {import('../types.js').Message} Message */
/** @typedef {import('../types.js').Part} Part */
/** @typedef {import('../types.js').Model} Model */
/** @typedef {{ provider: string, model: string }} Ctx */
export const api: "openai-responses";
export { operations } from "./openai-completions.js";
export type ApiModule = import("../types.js").ApiModule;
export type Message = import("../types.js").Message;
export type Part = import("../types.js").Part;
export type Model = import("../types.js").Model;
export type Ctx = {
    provider: string;
    model: string;
};
