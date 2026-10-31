/**
 * @param {{ api: string, compat?: Compat, headers?: Record<string, string> }} account
 * @param {{ compat?: Compat }} [model]
 * @returns {ResolvedCompat}
 */
export function resolveCompat(account: {
    api: string;
    compat?: Compat;
    headers?: Record<string, string>;
}, model?: {
    compat?: Compat;
}): ResolvedCompat;
/** @type {Readonly<Record<string, ResolvedCompat>>} */
export const DEFAULT_COMPAT: Readonly<Record<string, ResolvedCompat>>;
export type Compat = import("./types.js").Compat;
export type ResolvedCompat = import("./types.js").ResolvedCompat;
