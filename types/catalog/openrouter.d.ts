/**
 * Converte um item do catálogo. Devolve `null` para item sem `id` (não há como
 * endereçá-lo); `parseOpenRouterModels` o descarta.
 * @param {unknown} item
 * @returns {Model | null}
 */
export function parseOpenRouterModel(item: unknown): Model | null;
/**
 * Aceita o corpo inteiro (`{ data: [...] }`) ou o array. Itens sem `id` (ou que nem são
 * objeto) são descartados. Entrada que não é nenhuma das duas formas lança `TypeError`:
 * catálogo ilegível não vira lista vazia em silêncio.
 * @param {unknown} json
 * @returns {Model[]}
 */
export function parseOpenRouterModels(json: unknown): Model[];
export type Model = import("../types.js").Model;
export type Cost = import("../types.js").Cost;
export type Compat = import("../types.js").Compat;
