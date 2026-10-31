/** @typedef {{ firstByteMs?: number, idleMs?: number, totalMs?: number }} Timeouts */
/** @typedef {null|'aborted'|'first_byte'|'idle'|'total'} DeadlineReason */
/**
 * @param {{ timeouts?: Timeouts, signal?: AbortSignal }} [opts]
 */
export function createDeadline({ timeouts, signal }?: {
    timeouts?: Timeouts;
    signal?: AbortSignal;
}): {
    signal: AbortSignal;
    /** Chegou um pedaço: desarma o primeiro byte e rearma a inatividade. */
    touch(): void;
    /** Fim do pedido (com sucesso ou não): solta os relógios. */
    clear(): void;
    /** @returns {DeadlineReason} */
    reason(): DeadlineReason;
};
export const DEFAULT_TIMEOUTS: Readonly<{
    firstByteMs: 60000;
    idleMs: 60000;
    totalMs: 0;
}>;
export type Timeouts = {
    firstByteMs?: number;
    idleMs?: number;
    totalMs?: number;
};
export type DeadlineReason = null | "aborted" | "first_byte" | "idle" | "total";
