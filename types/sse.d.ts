/** @typedef {{ event?: string, data: string }} SSEEvent */
/**
 * Lê um corpo SSE e rende um evento por bloco. Aceita `\n` e `\r\n`, várias linhas
 * `data:` por evento e comentários (`:`). `onChunk` é chamado a cada pedaço lido.
 * @param {ReadableStream<Uint8Array> | AsyncIterable<Uint8Array|string>} body
 * @param {{ onChunk?: () => void }} [opts]
 * @returns {AsyncGenerator<SSEEvent>}
 */
export function readSSE(body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>, { onChunk }?: {
    onChunk?: () => void;
}): AsyncGenerator<SSEEvent>;
export type SSEEvent = {
    event?: string;
    data: string;
};
