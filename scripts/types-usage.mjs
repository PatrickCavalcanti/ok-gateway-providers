// Não roda: `npm run typecheck` confere este arquivo. Garante que cada método do cliente devolve o resultado da
// sua operação (e não `any`), como o consumidor TypeScript vê no .d.ts. Se um tipo regredir, o tsc falha aqui.
import { createClient } from '../src/index.js';

/** @typedef {import('../src/index.js').Account} Account */
/** @typedef {import('../src/index.js').Model} Model */

/**
 * @param {Account} account @param {Model} model
 */
export async function usage(account, model) {
  const client = createClient({ account, model });
  const { vectors, usage: embedUsage, cost, generationId } = await client.embed({ texts: ['a'], dimensions: 768 });
  const { text, durationSeconds } = await client.transcribe({ audio: new Uint8Array(), mime: 'audio/wav', filename: 'a.wav', language: 'pt', prompt: 'p' });
  const { audio, contentType } = await client.speak({ text: 'a', voice: 'v', format: 'mp3', instructions: 'i', speed: 1.1 });
  const { images } = await client.generateImage({ prompt: 'a' });
  const { answers } = await client.decide({ state: {}, questions: { pronto: { type: 'noul', instructions: 'i', criteria: { true: 'a', false: 'b' } } } });
  /** @type {number[][]} */ const v = vectors;
  /** @type {string} */ const t = text;
  /** @type {Uint8Array} */ const a = audio;
  /** @type {string} */ const ct = contentType;
  /** @type {{ base64: string, mediaType: string }[]} */ const imgs = images;
  /** @type {Record<string, unknown>} */ const ans = answers;
  /** @type {number|undefined} */ const d = durationSeconds;
  /** @type {string|undefined} */ const g = generationId;
  return [v, t, a, ct, imgs, ans, d, g, embedUsage.input, cost.usd];
}
