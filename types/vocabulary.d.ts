/** @param {unknown} list @returns {Operation[]} */
export function normalizeOperations(list: unknown): Operation[];
/** @param {unknown} list @returns {InputModality[]} */
export function normalizeInput(list: unknown): InputModality[];
/** @param {unknown} list @returns {OutputModality[]} */
export function normalizeOutput(list: unknown): OutputModality[];
/** Forma → string canônica (`text+image->text`), sem repetição e em ordem fixa. @param {{ input: unknown, output: unknown }} shape */
export function formatShape({ input, output }: {
    input: unknown;
    output: unknown;
}): string;
/** String → forma normalizada. @param {unknown} shape @returns {Shape} */
export function parseShape(shape: unknown): Shape;
/** Forma completa de um modelo. @param {{ input: unknown, output: unknown }} model */
export function shapeOf(model: {
    input: unknown;
    output: unknown;
}): string;
/** @param {{ operation?: unknown, shape?: unknown }} [request] @returns {ModelRequestKind} */
export function normalizeRequest({ operation, shape }?: {
    operation?: unknown;
    shape?: unknown;
}): ModelRequestKind;
/** `chat text+image->text`. @param {{ operation?: unknown, shape?: unknown }} request */
export function requestKey(request: {
    operation?: unknown;
    shape?: unknown;
}): string;
/** @param {unknown} key @returns {ModelRequestKind} */
export function parseRequestKey(key: unknown): ModelRequestKind;
/**
 * `null` quando o modelo atende o pedido; senão o motivo e o que falta.
 * Disponibilidade (chave, conta ativa) é do chamador.
 * @param {{ operations?: readonly string[], input?: readonly string[], output?: readonly string[] }} model
 * @param {{ operation?: unknown, shape?: unknown }} request
 * @returns {null | { reason: 'missing_operation'|'missing_input'|'missing_output', missing: string[] }}
 */
export function ineligibilityReason(model: {
    operations?: readonly string[];
    input?: readonly string[];
    output?: readonly string[];
}, request: {
    operation?: unknown;
    shape?: unknown;
}): null | {
    reason: "missing_operation" | "missing_input" | "missing_output";
    missing: string[];
};
/** @param {Parameters<typeof ineligibilityReason>[0]} model @param {Parameters<typeof ineligibilityReason>[1]} request */
export function isEligible(model: Parameters<typeof ineligibilityReason>[0], request: Parameters<typeof ineligibilityReason>[1]): boolean;
export const INPUT_MODALITIES: readonly ["text", "image", "file", "audio", "video"];
export const OUTPUT_MODALITIES: readonly ["text", "image", "audio", "embeddings"];
export const OPERATIONS: readonly ["chat", "decision", "embeddings", "transcription", "speech", "image-generation"];
/** @typedef {typeof INPUT_MODALITIES[number]} InputModality */
/** @typedef {typeof OUTPUT_MODALITIES[number]} OutputModality */
/** @typedef {typeof OPERATIONS[number]} Operation */
/** @typedef {{ input: InputModality[], output: OutputModality[] }} Shape */
/** @typedef {{ operation: Operation, shape: string }} ModelRequestKind */
/** Operação → métodos do cliente que a atendem. */
export const METHODS_BY_OPERATION: Readonly<{
    chat: readonly string[];
    decision: readonly string[];
    embeddings: readonly string[];
    transcription: readonly string[];
    speech: readonly string[];
    'image-generation': readonly string[];
}>;
export class VocabularyError extends Error {
    /** @param {string} message @param {Record<string, unknown>} [details] */
    constructor(message: string, details?: Record<string, unknown>);
    code: string;
    details: Record<string, unknown>;
}
/** O pedido de conversa só de texto. */
export const CHAT_TEXT: Readonly<{
    operation: Operation;
    shape: "text->text";
}>;
export type InputModality = (typeof INPUT_MODALITIES)[number];
export type OutputModality = (typeof OUTPUT_MODALITIES)[number];
export type Operation = (typeof OPERATIONS)[number];
export type Shape = {
    input: InputModality[];
    output: OutputModality[];
};
export type ModelRequestKind = {
    operation: Operation;
    shape: string;
};
