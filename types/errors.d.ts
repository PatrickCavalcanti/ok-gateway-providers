/** Corta o corpo em até 2 KB (em bytes UTF-8). @param {unknown} text @returns {string|undefined} */
export function truncateBody(text: unknown): string | undefined;
/**
 * @typedef {object} Diagnostic
 * @property {string|number} [code]  `error.code` do corpo (HTTP 429, `server_error`, `context_length_exceeded`…)
 * @property {string} [errorType]  `error.metadata.error_type` (OpenRouter), `error.type` (Anthropic, OpenAI) ou `error.status` (Gemini)
 * @property {string|number} [providerCode]  `error.metadata.provider_code`: o código do provedor por trás do roteador
 * @property {string} [providerName]  `error.metadata.provider_name`: o provedor por trás do roteador
 */
/**
 * O que um corpo de erro diz sobre a falha, sem o texto cru: lê `{ error: {...} }` (OpenRouter, Anthropic, OpenAI,
 * Gemini), e os eventos `response.failed` e `error`, que voltam com o fio Responses na E4. Corpo que não é JSON ou não é um erro
 * dá `{}`. Aceita o texto da resposta ou o objeto já lido.
 * @param {unknown} body @returns {Diagnostic}
 */
export function diagnosticFields(body: unknown): Diagnostic;
/** @param {number} status @returns {ErrorType} */
export function typeFromStatus(status: number): ErrorType;
/**
 * Erro a partir de um status HTTP (ou do código de um erro no corpo do stream).
 * @param {number} status
 * @param {{ provider?: string, model?: string, body?: unknown, emitted?: boolean, message?: string }} [ctx]
 */
export function errorFromStatus(status: number, { provider, model, body, emitted, message }?: {
    provider?: string;
    model?: string;
    body?: unknown;
    emitted?: boolean;
    message?: string;
}): ProviderError;
/** Mensagem legível de um corpo de erro em JSON (`{ error: { message } }` e variações). @param {unknown} body */
export function extractMessage(body: unknown): string | undefined;
/** Mídia ou parâmetro que o modelo não suporta — sempre antes do fetch. @param {string} message @param {{ provider?: string, model?: string }} [ctx] */
export function unsupported(message: string, { provider, model }?: {
    provider?: string;
    model?: string;
}): ProviderError;
/** @typedef {'auth'|'rate_limit'|'invalid_request'|'upstream'|'timeout'|'unsupported'|'aborted'} ErrorType */
export const MAX_BODY_BYTES: 2048;
export class ProviderError extends Error {
    /**
     * @param {{
     *   type: ErrorType, message: string, retryOther?: boolean, emitted?: boolean,
     *   status?: number, provider?: string, model?: string, body?: unknown, cause?: unknown,
     *   code?: string|number, errorType?: string, providerCode?: string|number, providerName?: string, generationId?: string,
     * }} init
     *   `code`, `errorType`, `providerCode` e `providerName` que faltam saem do `body`; `generationId` o cliente preenche
     *   (header `x-generation-id`)
     */
    constructor({ type, message, retryOther, emitted, status, provider, model, body, cause, generationId, ...diagnostic }: {
        type: ErrorType;
        message: string;
        retryOther?: boolean;
        emitted?: boolean;
        status?: number;
        provider?: string;
        model?: string;
        body?: unknown;
        cause?: unknown;
        code?: string | number;
        errorType?: string;
        providerCode?: string | number;
        providerName?: string;
        generationId?: string;
    });
    /** @type {ErrorType} */
    type: ErrorType;
    /** @type {boolean} */
    retryOther: boolean;
    /** @type {boolean} */
    emitted: boolean;
    /** @type {number|undefined} */
    status: number | undefined;
    /** @type {string|undefined} */
    provider: string | undefined;
    /** @type {string|undefined} */
    model: string | undefined;
    /** @type {string|undefined} */
    body: string | undefined;
    /** Código do erro no corpo (`error.code`). @type {string|number|undefined} */
    code: string | number | undefined;
    /** Tipo do erro no corpo (`error.metadata.error_type`, `error.type` ou `error.status`). @type {string|undefined} */
    errorType: string | undefined;
    /** Código do provedor por trás do roteador (`error.metadata.provider_code`). @type {string|number|undefined} */
    providerCode: string | number | undefined;
    /** Provedor por trás do roteador (`error.metadata.provider_name`). @type {string|undefined} */
    providerName: string | undefined;
    /** Id da geração no provedor (header `x-generation-id`), para diagnóstico. @type {string|undefined} */
    generationId: string | undefined;
}
export type Diagnostic = {
    /**
     * `error.code` do corpo (HTTP 429, `server_error`, `context_length_exceeded`…)
     */
    code?: string | number | undefined;
    /**
     * `error.metadata.error_type` (OpenRouter), `error.type` (Anthropic, OpenAI) ou `error.status` (Gemini)
     */
    errorType?: string | undefined;
    /**
     * `error.metadata.provider_code`: o código do provedor por trás do roteador
     */
    providerCode?: string | number | undefined;
    /**
     * `error.metadata.provider_name`: o provedor por trás do roteador
     */
    providerName?: string | undefined;
};
export type ErrorType = "auth" | "rate_limit" | "invalid_request" | "upstream" | "timeout" | "unsupported" | "aborted";
