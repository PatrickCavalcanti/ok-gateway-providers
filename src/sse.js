// ok-gateway-providers — leitor de Server-Sent Events.

/** @typedef {{ event?: string, data: string }} SSEEvent */

/**
 * Lê um corpo SSE e rende um evento por bloco. Aceita `\n` e `\r\n`, várias linhas
 * `data:` por evento e comentários (`:`). `onChunk` é chamado a cada pedaço lido.
 * @param {ReadableStream<Uint8Array> | AsyncIterable<Uint8Array|string>} body
 * @param {{ onChunk?: () => void }} [opts]
 * @returns {AsyncGenerator<SSEEvent>}
 */
export async function* readSSE(body, { onChunk } = {}) {
  const decoder = new TextDecoder();
  let buffer = '';
  /** @type {string|undefined} */ let event;
  /** @type {string[]} */ let data = [];

  /** @param {string} line @returns {SSEEvent|null} */
  const take = (line) => {
    if (line === '') {
      if (!data.length && event === undefined) return null;
      const ev = /** @type {SSEEvent} */ ({ data: data.join('\n') });
      if (event !== undefined) ev.event = event;
      event = undefined; data = [];
      return ev;
    }
    if (line.startsWith(':')) return null;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    return null;
  };

  for await (const chunk of iterate(body)) {
    onChunk?.();
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.search(/\r\n|\n|\r/)) !== -1) {
      // Um `\r` no fim do pedaço pode ser a metade de um `\r\n`: espera o próximo.
      if (buffer[nl] === '\r' && nl === buffer.length - 1) break;
      const line = buffer.slice(0, nl);
      const sepLen = buffer.startsWith('\r\n', nl) ? 2 : 1;
      buffer = buffer.slice(nl + sepLen);
      const ev = take(line);
      if (ev) yield ev;
    }
  }
  buffer += decoder.decode();
  if (buffer) { const ev = take(buffer); if (ev) yield ev; }
  const last = take('');
  if (last) yield last;
}

/**
 * @param {ReadableStream<Uint8Array> | AsyncIterable<Uint8Array|string>} body
 * @returns {AsyncIterable<Uint8Array|string>}
 */
function iterate(body) {
  if (body && typeof (/** @type {any} */ (body))[Symbol.asyncIterator] === 'function') {
    return /** @type {AsyncIterable<Uint8Array|string>} */ (body);
  }
  const reader = /** @type {ReadableStream<Uint8Array>} */ (body).getReader();
  return {
    async *[Symbol.asyncIterator]() {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
