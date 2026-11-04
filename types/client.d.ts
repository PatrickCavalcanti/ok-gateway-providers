/** Registra um fio. Os do núcleo são registrados pelo `index.js`. @param {ApiModule} mod */
export function registerApi(mod: ApiModule): void;
/** @param {string} api */
export function getApi(api: string): import("./types.js").ApiModule | undefined;
/** Fios registrados. */
export function listApis(): string[];
/**
 * Os métodos de operação saem de `METHODS_BY_OPERATION` (spec §3): operação nova na tabela ganha o método sem
 * editar o cliente. O tipo de cada método é o do typedef `Client`, que um teste confere contra a tabela.
 * @param {{ account: Account, model: Model, fetch?: typeof globalThis.fetch }} opts
 * @returns {Client}
 */
export function createClient({ account, model, fetch: fetchImpl }: {
    account: Account;
    model: Model;
    fetch?: typeof globalThis.fetch;
}): Client;
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
export type Client = import("./types.js").Client;
export type OperationTypes = import("./types.js").OperationTypes;
