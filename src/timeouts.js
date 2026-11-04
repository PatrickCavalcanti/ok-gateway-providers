// ok-gateway-providers — prazos de um pedido (spec §8).
//
// Um AbortController próprio, ligado ao `signal` do chamador. Três relógios:
// primeiro byte (arma ao criar), inatividade (rearma a cada chunk) e total.

export const DEFAULT_TIMEOUTS = Object.freeze({ firstByteMs: 60_000, idleMs: 60_000, totalMs: 0 });

/** @typedef {{ firstByteMs?: number, idleMs?: number, totalMs?: number }} Timeouts */

/**
 * Padrão por operação, abaixo do da conta e do pedido. Gerar imagem responde só no fim: medido
 * em 51 s e além de 60 s no OpenRouter (2026-11-04).
 * @type {Readonly<Record<string, Timeouts>>}
 */
export const OPERATION_TIMEOUTS = Object.freeze({ 'image-generation': Object.freeze({ firstByteMs: 180_000 }) });
/** @typedef {null|'aborted'|'first_byte'|'idle'|'total'} DeadlineReason */

/**
 * @param {{ timeouts?: Timeouts, signal?: AbortSignal }} [opts]
 */
export function createDeadline({ timeouts = {}, signal } = {}) {
  const t = { ...DEFAULT_TIMEOUTS, ...stripUndefined(timeouts) };
  const controller = new AbortController();
  /** @type {DeadlineReason} */
  let reason = null;
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let firstTimer;
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let idleTimer;
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let totalTimer;
  let gotFirst = false;
  let done = false;

  /** @param {Exclude<DeadlineReason, null>} r */
  const fire = (r) => {
    if (done || reason) return;
    reason = r;
    clearAll();
    controller.abort(new Error(r === 'aborted' ? 'aborted' : `timeout: ${r}`));
  };
  const clearAll = () => {
    clearTimeout(firstTimer); clearTimeout(idleTimer); clearTimeout(totalTimer);
    signal?.removeEventListener('abort', onCallerAbort);
  };
  const onCallerAbort = () => fire('aborted');

  if (signal?.aborted) {
    fire('aborted');
  } else {
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    if (t.firstByteMs > 0) firstTimer = setTimeout(() => fire('first_byte'), t.firstByteMs);
    if (t.totalMs > 0) totalTimer = setTimeout(() => fire('total'), t.totalMs);
  }

  return {
    signal: controller.signal,
    /** Chegou um pedaço: desarma o primeiro byte e rearma a inatividade. */
    touch() {
      if (done || reason) return;
      if (!gotFirst) { gotFirst = true; clearTimeout(firstTimer); }
      clearTimeout(idleTimer);
      if (t.idleMs > 0) idleTimer = setTimeout(() => fire('idle'), t.idleMs);
    },
    /** Fim do pedido (com sucesso ou não): solta os relógios. */
    clear() { done = true; clearAll(); },
    /** @returns {DeadlineReason} */
    reason() { return reason; },
  };
}

/** @param {Record<string, unknown>} o @returns {Record<string, number>} */
function stripUndefined(o) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(o ?? {})) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}
