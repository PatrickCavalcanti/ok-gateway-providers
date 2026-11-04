/**
 * Copia as camadas de `params` (modelo, depois a chamada: a última vence) para o corpo. Chave protegida e
 * valor `undefined` ficam de fora; descartar chave protegida é deliberado e não gera erro.
 * @param {Record<string, any>} body
 * @param {(Record<string, unknown>|undefined)[]} layers
 * @param {(key: string) => boolean} skip
 */
export function applyParams(body: Record<string, any>, layers: (Record<string, unknown> | undefined)[], skip: (key: string) => boolean): void;
/**
 * Funde o objeto explícito no que o `params` já pôs em `body[key]` (o explícito vence campo a campo).
 * Sem explícito, não mexe. Nunca altera o objeto do chamador.
 * @param {Record<string, any>} body @param {string} key @param {Record<string, unknown>|undefined} explicit
 */
export function fuse(body: Record<string, any>, key: string, explicit: Record<string, unknown> | undefined): void;
export function isPlainObject(v: unknown): v is Record<string, any>;
