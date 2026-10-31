/** Registra um fio. Os do núcleo são registrados pelo `index.js`. @param {ApiModule} mod */
export function registerApi(mod: ApiModule): void;
/** @param {string} api */
export function getApi(api: string): import("./types.js").ApiModule | undefined;
/** Fios registrados. */
export function listApis(): string[];
/**
 * @param {{ account: Account, model: Model, fetch?: typeof globalThis.fetch }} opts
 */
export function createClient({ account, model, fetch: fetchImpl }: {
    account: Account;
    model: Model;
    fetch?: typeof globalThis.fetch;
}): {
    account: import("./types.js").Account;
    model: import("./types.js").Model;
    /** @param {ChatRequest} request */
    chat(request: ChatRequest): Run;
};
export type Run = AsyncIterable<ChatEvent> & {
    result: Promise<ChatResult>;
    abort(): void;
};
export type Account = import("./types.js").Account;
export type Model = import("./types.js").Model;
export type ChatRequest = import("./types.js").ChatRequest;
export type ChatEvent = import("./types.js").ChatEvent;
export type ChatResult = import("./types.js").ChatResult;
export type ApiModule = import("./types.js").ApiModule;
