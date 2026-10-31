// ok-gateway-providers — vocabulário de operação e forma.
//
// O ÚNICO lugar com literais de mídia e operação. As mídias e os nomes são os do
// OpenRouter (`architecture.input_modalities` / `output_modalities`). Reescrito a partir
// do `vocabulario.js` do Igris (spec 2026-10-29), sem as funções de capability legada.

export const INPUT_MODALITIES = Object.freeze(/** @type {const} */ (['text', 'image', 'file', 'audio', 'video']));
export const OUTPUT_MODALITIES = Object.freeze(/** @type {const} */ (['text', 'image', 'audio', 'embeddings']));
export const OPERATIONS = Object.freeze(/** @type {const} */ (['chat', 'decision', 'embeddings', 'transcription', 'speech', 'image-generation']));

/** @typedef {typeof INPUT_MODALITIES[number]} InputModality */
/** @typedef {typeof OUTPUT_MODALITIES[number]} OutputModality */
/** @typedef {typeof OPERATIONS[number]} Operation */
/** @typedef {{ input: InputModality[], output: OutputModality[] }} Shape */
/** @typedef {{ operation: Operation, shape: string }} ModelRequestKind */

/** Operação → métodos do cliente que a atendem. */
export const METHODS_BY_OPERATION = Object.freeze({
  chat: Object.freeze(['chat']),
  decision: Object.freeze(['decide']),
  embeddings: Object.freeze(['embed']),
  transcription: Object.freeze(['transcribe']),
  speech: Object.freeze(['speak']),
  'image-generation': Object.freeze(['generateImage']),
});

export class VocabularyError extends Error {
  /** @param {string} message @param {Record<string, unknown>} [details] */
  constructor(message, details = {}) {
    super(`InvalidVocabulary: ${message}`);
    this.name = 'VocabularyError';
    this.code = 'InvalidVocabulary';
    this.details = details;
  }
}

/**
 * @template {string} T
 * @param {unknown} list @param {readonly T[]} universe @param {string} field
 * @returns {T[]}
 */
function normalize(list, universe, field) {
  if (!Array.isArray(list)) throw new VocabularyError(`${field} precisa ser uma lista`, { field });
  const unknown = list.filter((m) => !universe.includes(m));
  if (unknown.length) {
    throw new VocabularyError(
      `${field} com valor desconhecido: ${unknown.join(', ')} (aceitos: ${universe.join(', ')})`,
      { field, unknown, accepted: [...universe] },
    );
  }
  return universe.filter((m) => list.includes(m));
}

/** @param {unknown} list @returns {Operation[]} */
export function normalizeOperations(list) { return normalize(list, OPERATIONS, 'operations'); }
/** @param {unknown} list @returns {InputModality[]} */
export function normalizeInput(list) { return normalize(list, INPUT_MODALITIES, 'input'); }
/** @param {unknown} list @returns {OutputModality[]} */
export function normalizeOutput(list) { return normalize(list, OUTPUT_MODALITIES, 'output'); }

/** Forma → string canônica (`text+image->text`), sem repetição e em ordem fixa. @param {{ input: unknown, output: unknown }} shape */
export function formatShape({ input, output }) {
  const i = normalizeInput(input);
  const o = normalizeOutput(output);
  if (!i.length || !o.length) throw new VocabularyError('forma precisa de ao menos uma mídia de entrada e uma de saída');
  return `${i.join('+')}->${o.join('+')}`;
}

/** String → forma normalizada. @param {unknown} shape @returns {Shape} */
export function parseShape(shape) {
  const parts = String(shape ?? '').split('->');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new VocabularyError(`forma "${shape}" fora do formato "entrada->saida"`, { shape });
  }
  return { input: normalizeInput(parts[0].split('+')), output: normalizeOutput(parts[1].split('+')) };
}

/** Forma completa de um modelo. @param {{ input: unknown, output: unknown }} model */
export function shapeOf(model) {
  return formatShape({ input: model.input, output: model.output });
}

/** @param {{ operation?: unknown, shape?: unknown }} [request] @returns {ModelRequestKind} */
export function normalizeRequest({ operation, shape } = {}) {
  if (typeof operation !== 'string' || !OPERATIONS.includes(/** @type {Operation} */ (operation))) {
    throw new VocabularyError(`operação desconhecida: ${operation} (aceitas: ${OPERATIONS.join(', ')})`, { operation });
  }
  return { operation: /** @type {Operation} */ (operation), shape: formatShape(parseShape(shape)) };
}

/** `chat text+image->text`. @param {{ operation?: unknown, shape?: unknown }} request */
export function requestKey(request) {
  const { operation, shape } = normalizeRequest(request);
  return `${operation} ${shape}`;
}

/** @param {unknown} key @returns {ModelRequestKind} */
export function parseRequestKey(key) {
  const [operation, shape, ...rest] = String(key ?? '').split(' ');
  if (rest.length) throw new VocabularyError(`chave de pedido "${key}" inválida`, { key });
  return normalizeRequest({ operation, shape });
}

/** O pedido de conversa só de texto. */
export const CHAT_TEXT = Object.freeze({ operation: /** @type {Operation} */ ('chat'), shape: 'text->text' });

/**
 * `null` quando o modelo atende o pedido; senão o motivo e o que falta.
 * Disponibilidade (chave, conta ativa) é do chamador.
 * @param {{ operations?: readonly string[], input?: readonly string[], output?: readonly string[] }} model
 * @param {{ operation?: unknown, shape?: unknown }} request
 * @returns {null | { reason: 'missing_operation'|'missing_input'|'missing_output', missing: string[] }}
 */
export function ineligibilityReason(model, request) {
  const { operation, shape } = normalizeRequest(request);
  const { input, output } = parseShape(shape);
  if (!(model?.operations ?? []).includes(operation)) return { reason: 'missing_operation', missing: [operation] };
  const missingIn = input.filter((m) => !(model.input ?? []).includes(m));
  if (missingIn.length) return { reason: 'missing_input', missing: missingIn };
  const missingOut = output.filter((m) => !(model.output ?? []).includes(m));
  if (missingOut.length) return { reason: 'missing_output', missing: missingOut };
  return null;
}

/** @param {Parameters<typeof ineligibilityReason>[0]} model @param {Parameters<typeof ineligibilityReason>[1]} request */
export function isEligible(model, request) {
  return ineligibilityReason(model, request) === null;
}
