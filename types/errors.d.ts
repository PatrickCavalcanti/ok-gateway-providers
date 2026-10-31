/** Corta o corpo em até 2 KB (em bytes UTF-8). @param {unknown} text @returns {string|undefined} */
export function truncateBody(text: unknown): string | undefined;
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
     * }} init
     */
    constructor({ type, message, retryOther, emitted, status, provider, model, body, cause }: {
        type: ErrorType;
        message: string;
        retryOther?: boolean;
        emitted?: boolean;
        status?: number;
        provider?: string;
        model?: string;
        body?: unknown;
        cause?: unknown;
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
}
export type ErrorType = "auth" | "rate_limit" | "invalid_request" | "upstream" | "timeout" | "unsupported" | "aborted";
