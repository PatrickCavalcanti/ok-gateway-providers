import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOpenRouterModels, parseOpenRouterModel } from '../src/catalog/openrouter.js';
import { computeCost } from '../src/cost.js';

const body = JSON.parse(readFileSync(new URL('./fixtures/catalog/openrouter-models.json', import.meta.url), 'utf8'));
const models = parseOpenRouterModels(body);
/** @param {string} id */
const byId = (id) => {
  const m = models.find((x) => x.id === id);
  assert.ok(m, `modelo ${id} não encontrado`);
  return m;
};

test('aceita o corpo inteiro ou o array, e descarta item sem id', () => {
  assert.equal(models.length, 8);
  assert.deepEqual(parseOpenRouterModels(body.data).map((m) => m.id), models.map((m) => m.id));
  assert.equal(parseOpenRouterModel({ name: 'sem id' }), null);
  assert.equal(parseOpenRouterModel({ id: '  ' }), null);
  assert.equal(parseOpenRouterModel(null), null);
  assert.deepEqual(parseOpenRouterModels({ data: [null, 'x', { id: 'a/b' }] }).map((m) => m.id), ['a/b']);
});

test('corpo ilegível lança em vez de virar lista vazia', () => {
  assert.throws(() => parseOpenRouterModels({}), TypeError);
  assert.throws(() => parseOpenRouterModels(null), TypeError);
  assert.throws(() => parseOpenRouterModels('x'), TypeError);
  assert.deepEqual(parseOpenRouterModels({ data: [] }), []);
});

test('texto com structured_outputs: tudo mapeado', () => {
  const m = byId('openai/gpt-x-mini');
  assert.equal(m.name, 'OpenAI: GPT-X Mini');
  assert.deepEqual(m.operations, ['chat']);
  assert.deepEqual(m.input, ['text', 'image']);
  assert.deepEqual(m.output, ['text']);
  assert.equal(m.contextWindow, 400000);
  assert.equal(m.maxTokens, 128000);
  assert.equal(m.reasoning, true);
  assert.deepEqual(m.cost, { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.375 });
  assert.deepEqual(m.compat, {
    usageInStream: true, providerRouting: true, structuredOutput: 'response_format',
    supportsTemperature: true, reasoningFormat: 'reasoning_object',
  });
});

test('preço sem ruído de ponto flutuante', () => {
  // 0.0000003 * 1e6 = 0.30000000000000004 sem o toPrecision.
  const c = byId('openai/gpt-x-mini').cost;
  assert.equal(c?.input, 0.3);
  assert.equal(c?.cacheWrite, 0.375);
  assert.equal(byId('google/gemini-x-multi').cost?.input, 1);
});

test('só response_format (sem structured_outputs) vira structuredOutput "none"', () => {
  const m = byId('qwen/qwen3.7-flash');
  assert.equal(m.compat?.structuredOutput, 'none');
  assert.equal(m.reasoning, true, 'include_reasoning basta');
  assert.equal(m.compat?.reasoningFormat, 'reasoning_object');
  assert.equal(m.maxTokens, undefined, 'max_completion_tokens null não vira número');
  assert.deepEqual(m.cost, { input: 0.05, output: 0.4 });
});

test('modelo sem reasoning não leva reasoning nem reasoningFormat; sem temperature na lista, supportsTemperature false', () => {
  const m = byId('google/gemini-x-image');
  assert.equal(m.reasoning, undefined);
  assert.equal(m.compat?.reasoningFormat, undefined);
  assert.equal(m.compat?.supportsTemperature, true);
  const semTemp = byId('google/gemini-x-multi');
  assert.equal(semTemp.compat?.supportsTemperature, false);
});

test('multimodal: mídias na ordem canônica, mesmo que o catálogo mande desordenado', () => {
  const m = byId('google/gemini-x-multi');
  assert.deepEqual(m.input, ['text', 'image', 'file', 'audio', 'video']);
  assert.deepEqual(m.output, ['text']);
  assert.equal(m.meta?.unknownModalities, undefined);
});

test('gerador de imagem: saída text+image em ordem canônica, operação chat', () => {
  const m = byId('google/gemini-x-image');
  assert.deepEqual(m.output, ['text', 'image']);
  assert.deepEqual(m.operations, ['chat']);
  // preço de imagem (campo que a lib não interpreta) não some: fica no meta.pricing
  assert.equal((/** @type {any} */ (m.meta?.pricing)).image, '0.0000300');
});

test('embeddings: operação embeddings, sem structuredOutput inventado', () => {
  const m = byId('openai/text-embedding-x');
  assert.deepEqual(m.operations, ['embeddings']);
  assert.deepEqual(m.output, ['embeddings']);
  assert.deepEqual(m.cost, { input: 0.02, output: 0 });
  // lista supported_parameters existe e é vazia: structuredOutput 'none', temperature false
  assert.equal(m.compat?.structuredOutput, 'none');
});

test('grátis: preço "0" é zero de verdade, não ausência', () => {
  const m = byId('meta-llama/llama-x-8b:free');
  assert.deepEqual(m.cost, { input: 0, output: 0 });
  assert.deepEqual(computeCost(m, { input: 1000, output: 1000 }), { usd: 0, source: 'table' });
});

test('preço "-1" (variável): sem cost e meta.pricingVariable', () => {
  const m = byId('openrouter/auto');
  assert.equal(m.cost, undefined);
  assert.equal(m.meta?.pricingVariable, true);
  assert.deepEqual(computeCost(m, { input: 1000, output: 1000 }), { usd: null, source: 'none' });
  assert.equal(byId('openai/gpt-x-mini').meta?.pricingVariable, undefined);
});

test('preço ausente fica ausente: sem prompt/completion não há cost; cache ausente não aparece', () => {
  assert.equal(parseOpenRouterModel({ id: 'a/b', pricing: {} })?.cost, undefined);
  assert.equal(parseOpenRouterModel({ id: 'a/b', pricing: { prompt: '0.000001' } })?.cost, undefined);
  assert.equal(parseOpenRouterModel({ id: 'a/b' })?.cost, undefined);
  assert.equal(parseOpenRouterModel({ id: 'a/b', pricing: { prompt: 'abc', completion: '1' } })?.cost, undefined);
  assert.deepEqual(parseOpenRouterModel({ id: 'a/b', pricing: { prompt: '0.000001', completion: '0.000002' } })?.cost, { input: 1, output: 2 });
});

test('bloco gateway e o resto do item ficam em meta', () => {
  const m = byId('anthropic/claude-haiku-5-5');
  assert.deepEqual(m.meta?.gateway, { provider: 'anthropic', available: true, credits: { input: 0.55, output: 2.75 } });
  assert.deepEqual(m.meta?.supported_parameters, ['max_tokens', 'temperature', 'tools', 'reasoning']);
  assert.equal(typeof m.meta?.top_provider, 'object');
  assert.deepEqual(m.meta?.architecture, { modality: 'text+image->text', tokenizer: 'Claude', instruct_type: null });
  assert.equal(byId('openai/gpt-x-mini').meta?.description, 'Modelo pequeno de texto com saída estruturada por gramática.');
  // o que a lib já interpretou não se repete no meta
  assert.equal('id' in (m.meta ?? {}), false);
  assert.equal('name' in (m.meta ?? {}), false);
  assert.equal('context_length' in (m.meta ?? {}), false);
});

test('modalidade fora do vocabulário vai para meta.unknownModalities (nada some em silêncio)', () => {
  const m = parseOpenRouterModel({
    id: 'x/y',
    architecture: { input_modalities: ['text', 'hologram', 'image'], output_modalities: ['text', 'smell'] },
  });
  assert.deepEqual(m?.input, ['text', 'image']);
  assert.deepEqual(m?.output, ['text']);
  assert.deepEqual(m?.meta?.unknownModalities, { input: ['hologram'], output: ['smell'] });
});

test('sem architecture: cai em text->text e avisa em meta.modalitiesAssumed', () => {
  const m = parseOpenRouterModel({ id: 'x/y' });
  assert.deepEqual(m?.input, ['text']);
  assert.deepEqual(m?.output, ['text']);
  assert.equal(m?.meta?.modalitiesAssumed, true);
  assert.equal(byId('openai/gpt-x-mini').meta?.modalitiesAssumed, undefined);
});

test('sem supported_parameters: compat não afirma structuredOutput nem supportsTemperature', () => {
  const m = parseOpenRouterModel({ id: 'x/y', architecture: { input_modalities: ['text'], output_modalities: ['text'] } });
  assert.deepEqual(m?.compat, { usageInStream: true, providerRouting: true });
  assert.equal(m?.reasoning, undefined);
});

test('todo modelo do catálogo sai com operations/input/output não vazios e passa pelo vocabulário', () => {
  for (const m of models) {
    assert.ok(m.operations.length >= 1, m.id);
    assert.ok(m.input.length >= 1, m.id);
    assert.ok(m.output.length >= 1, m.id);
  }
});

test('catálogo declara o transporte de vídeo e áudio do OpenRouter', () => {
  const [m] = parseOpenRouterModels({ data: [{ id: 'g/v', architecture: { input_modalities: ['text', 'video', 'audio'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } }] });
  assert.deepEqual(m.transport, { video: 'video_url', audio: 'input_audio' });
  const [t] = parseOpenRouterModels({ data: [{ id: 'g/t', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } }] });
  assert.equal(t.transport, undefined);
});

test('operação por modalidade de saída: embeddings vira embeddings', () => {
  const m = parseOpenRouterModel({ id: 't/emb', architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] } });
  assert.deepEqual(m?.operations, ['embeddings']);
});

test('operação por modalidade de saída: só image vira image-generation', () => {
  const m = parseOpenRouterModel({ id: 't/img', architecture: { input_modalities: ['text'], output_modalities: ['image'] } });
  assert.deepEqual(m?.operations, ['image-generation']);
});

test('operação por modalidade de saída: só audio vira speech', () => {
  const m = parseOpenRouterModel({ id: 't/aud', architecture: { input_modalities: ['text'], output_modalities: ['audio'] } });
  assert.deepEqual(m?.operations, ['speech']);
});

test('operação por modalidade de saída: text+image segue chat', () => {
  const m = parseOpenRouterModel({ id: 't/chat-img', architecture: { input_modalities: ['text'], output_modalities: ['text', 'image'] } });
  assert.deepEqual(m?.operations, ['chat']);
});

test('operação por modalidade de saída: só text segue chat', () => {
  const m = parseOpenRouterModel({ id: 't/chat-txt', architecture: { input_modalities: ['text'], output_modalities: ['text'] } });
  assert.deepEqual(m?.operations, ['chat']);
});
