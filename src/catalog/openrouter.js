// ok-gateway-providers — leitor do catálogo de modelos do OpenRouter (spec §10).
//
// Lê o corpo de `GET /api/v1/models` (também o de `/api/v1/embeddings/models` e o
// `GET /v1/models` do Gateway, que usa o mesmo formato com um bloco `gateway`) e devolve
// `Model[]`. Não faz rede: quem busca é o chamador. Nada que o catálogo declara some em
// silêncio: o que a lib não interpreta vai para `model.meta`.

import { INPUT_MODALITIES, OUTPUT_MODALITIES } from '../vocabulary.js';

/** @typedef {import('../types.js').Model} Model */
/** @typedef {import('../types.js').Cost} Cost */
/** @typedef {import('../types.js').Compat} Compat */

const PER_MILLION = 1_000_000;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} v */
const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/**
 * Preço em US$/token (string, como o OpenRouter manda) → US$/milhão (number).
 * `undefined` = ausente ou ilegível; negativo é devolvido como veio (o chamador decide).
 * `toPrecision` tira o ruído de ponto flutuante ("0.0000003" × 1e6 = 0.30000000000000004).
 * @param {unknown} v
 */
function perMillion(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Number((n * PER_MILLION).toPrecision(12));
}

/**
 * Mantém só o que o vocabulário conhece (em ordem canônica); o resto sai em `unknown`.
 * @template {string} T
 * @param {unknown} list @param {readonly T[]} universe
 * @returns {{ known: T[], unknown: string[] }}
 */
function splitModalities(list, universe) {
  const given = Array.isArray(list) ? list : [];
  const known = universe.filter((m) => given.includes(m));
  const unknown = [...new Set(given.filter((m) => !universe.includes(m)).map(String))];
  return { known, unknown };
}

/**
 * Converte um item do catálogo. Devolve `null` para item sem `id` (não há como
 * endereçá-lo); `parseOpenRouterModels` o descarta.
 * @param {unknown} item
 * @returns {Model | null}
 */
export function parseOpenRouterModel(item) {
  if (!isObject(item)) return null;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  if (!id) return null;

  const arch = isObject(item.architecture) ? item.architecture : null;
  const input = splitModalities(arch?.input_modalities, INPUT_MODALITIES);
  const output = splitModalities(arch?.output_modalities, OUTPUT_MODALITIES);

  /** @type {Record<string, unknown>} */
  const meta = {};
  for (const [key, value] of Object.entries(item)) {
    if (key === 'id' || key === 'name' || key === 'context_length' || key === 'architecture') continue;
    meta[key] = value;
  }
  if (arch) {
    // modalidades interpretadas saem; `modality`, `tokenizer`, `instruct_type` ficam.
    const { input_modalities: _i, output_modalities: _o, ...rest } = arch;
    if (Object.keys(rest).length) meta.architecture = rest;
  }
  const unknownModalities = {};
  if (input.unknown.length) Object.assign(unknownModalities, { input: input.unknown });
  if (output.unknown.length) Object.assign(unknownModalities, { output: output.unknown });
  if (Object.keys(unknownModalities).length) meta.unknownModalities = unknownModalities;

  // Sem `architecture` não há o que ler: cai em texto→texto, e `meta` diz que foi suposição.
  let inputList = input.known;
  let outputList = output.known;
  if (!arch) {
    inputList = ['text'];
    outputList = ['text'];
    meta.modalitiesAssumed = true;
  }

  // Mesma regra do Igris (`listasDoCatalogoOpenRouter`): saída 'embeddings' → embeddings,
  // o resto → chat. Geração de imagem do OpenRouter é chat com saída de imagem.
  /** @type {Model['operations']} */
  const operations = outputList.includes('embeddings') ? ['embeddings'] : ['chat'];

  /** @type {Model} */
  const model = { id, operations, input: inputList, output: outputList };
  if (typeof item.name === 'string' && item.name) model.name = item.name;

  const contextWindow = positive(item.context_length);
  if (contextWindow !== undefined) model.contextWindow = contextWindow;
  const maxTokens = isObject(item.top_provider) ? positive(item.top_provider.max_completion_tokens) : undefined;
  if (maxTokens !== undefined) model.maxTokens = maxTokens;

  // Preço. "0" é zero de verdade (modelo grátis); ausente fica ausente; negativo ("-1")
  // é o "variável" do OpenRouter — sem `cost`, e o fato vai para `meta.pricingVariable`.
  if (isObject(item.pricing)) {
    const p = item.pricing;
    const prompt = perMillion(p.prompt);
    const completion = perMillion(p.completion);
    const cacheRead = perMillion(p.input_cache_read);
    const cacheWrite = perMillion(p.input_cache_write);
    const used = [prompt, completion, cacheRead, cacheWrite];
    if (used.some((v) => v !== undefined && v < 0)) {
      meta.pricingVariable = true;
    } else if (prompt !== undefined && completion !== undefined) {
      /** @type {Cost} */
      const cost = { input: prompt, output: completion };
      if (cacheRead !== undefined) cost.cacheRead = cacheRead;
      if (cacheWrite !== undefined) cost.cacheWrite = cacheWrite;
      model.cost = cost;
    }
  }

  const params = Array.isArray(item.supported_parameters) ? item.supported_parameters : null;
  const reasoning = !!params && (params.includes('reasoning') || params.includes('include_reasoning'));
  if (reasoning) model.reasoning = true;

  /** @type {Compat} */
  const compat = { usageInStream: true, providerRouting: true };
  if (params) {
    // `structured_outputs` = schema imposto por gramática. Só `response_format` dá JSON
    // bem formado no formato errado — pior que recusa limpa —, então fica 'none'.
    compat.structuredOutput = params.includes('structured_outputs') ? 'response_format' : 'none';
    compat.supportsTemperature = params.includes('temperature');
  }
  if (reasoning) compat.reasoningFormat = 'reasoning_object';
  model.compat = compat;

  // Transporte de mídia como o OpenRouter aceita no Chat Completions: vídeo por
  // `video_url` (url ou data-url) e áudio por `input_audio`. Sem isso, vídeo de um modelo
  // do catálogo daria `unsupported` sempre (o anexo não adivinha transporte de vídeo).
  /** @type {import('../types.js').Transport} */
  const transport = {};
  if (inputList.includes('video')) transport.video = 'video_url';
  if (inputList.includes('audio')) transport.audio = 'input_audio';
  if (Object.keys(transport).length) model.transport = transport;

  if (Object.keys(meta).length) model.meta = meta;
  return model;
}

/**
 * Aceita o corpo inteiro (`{ data: [...] }`) ou o array. Itens sem `id` (ou que nem são
 * objeto) são descartados. Entrada que não é nenhuma das duas formas lança `TypeError`:
 * catálogo ilegível não vira lista vazia em silêncio.
 * @param {unknown} json
 * @returns {Model[]}
 */
export function parseOpenRouterModels(json) {
  const list = Array.isArray(json) ? json : isObject(json) && Array.isArray(json.data) ? json.data : null;
  if (!list) throw new TypeError('catálogo do OpenRouter sem a lista "data" (esperava { data: [...] } ou um array)');
  /** @type {Model[]} */
  const models = [];
  for (const item of list) {
    const model = parseOpenRouterModel(item);
    if (model) models.push(model);
  }
  return models;
}
