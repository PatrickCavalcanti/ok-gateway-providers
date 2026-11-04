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
    /** @param {{ texts: string[], dimensions?: number, params?: Record<string, unknown>, signal?: AbortSignal, timeouts?: import('./timeouts.js').Timeouts }} request */
    embed(request: {
        texts: string[];
        dimensions?: number;
        params?: Record<string, unknown>;
        signal?: AbortSignal;
        timeouts?: import("./timeouts.js").Timeouts;
    }): Promise<{
        usage: import("./types.js").Usage;
        cost: import("./types.js").CostResult;
    }>;
    /** @param {any} request */
    transcribe(request: any): Promise<{
        usage: import("./types.js").Usage;
        cost: import("./types.js").CostResult;
    }>;
    /** @param {any} request */
    speak(request: any): Promise<{
        usage: import("./types.js").Usage;
        cost: import("./types.js").CostResult;
    }>;
    /** @param {any} request */
    generateImage(request: any): Promise<{
        usage: import("./types.js").Usage;
        cost: import("./types.js").CostResult;
    }>;
    /** @param {any} request */
    decide(request: any): Promise<{
        usage: import("./types.js").Usage;
        cost: import("./types.js").CostResult;
    }>;
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
