// Fio openai-responses: rastreio de tool call com identificadores que mudam entre eventos.
// Cenários do revisor (resp-scenarios.mjs): uma chamada sai uma vez só e nunca dá erro depois de emitir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStream } from '../src/apis/openai-responses.js';

const account = { provider: 't' };
const model = { id: 'm' };

/** @param {object[]} frames */
async function run(frames) {
  const events = (async function* () { for (const f of frames) yield { data: JSON.stringify(f) }; })();
  const gen = parseStream(events, { account, model });
  /** @type {any[]} */ const out = [];
  try {
    while (true) {
      const s = await gen.next();
      if (s.done) return { out, calls: out.filter((e) => e.type === 'tool_call'), finish: s.value.finishReason, error: null };
      out.push(s.value);
    }
  } catch (e) {
    return { out, calls: out.filter((e2) => e2.type === 'tool_call'), finish: null, error: /** @type {any} */ (e) };
  }
}

const added = (id, call_id, idx = 0, extra = {}) => ({ type: 'response.output_item.added', output_index: idx, item: { type: 'function_call', id, call_id, name: 'f', arguments: '', ...extra } });
const delta = (item_id, d, idx = 0) => ({ type: 'response.function_call_arguments.delta', ...(item_id !== undefined ? { item_id } : {}), ...(idx !== undefined ? { output_index: idx } : {}), delta: d });
const done = (item, idx) => ({ type: 'response.output_item.done', ...(idx !== undefined ? { output_index: idx } : {}), item: { type: 'function_call', name: 'f', ...item } });
const fcall = (item) => ({ type: 'function_call', name: 'f', ...item });
const completed = (output = []) => ({ type: 'response.completed', response: { output, usage: { input_tokens: 1, output_tokens: 1 } } });
const incomplete = (output = []) => ({ type: 'response.incomplete', response: { output, incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 1, output_tokens: 1 } } });

/** Uma chamada só, sem erro, com estes id e argumentos. */
function assertOne(r, id, args, nome) {
  assert.equal(r.error, null, `${nome}: ${r.error?.message}`);
  assert.deepEqual(r.calls.map((c) => [c.id, c.arguments]), [[id, args]], nome);
  assert.equal(r.finish, 'tool_calls', nome);
}

test('A normal', async () => {
  assertOne(await run([added('fc1', 'c1'), delta('fc1', '{"a":1}'), done({ id: 'fc1', call_id: 'c1', arguments: '{"a":1}' }, 0), completed([fcall({ id: 'fc1', call_id: 'c1', arguments: '{"a":1}' })])]), 'c1', '{"a":1}', 'A');
});

test('B formato do llama.cpp: done e final sem id nem output_index', async () => {
  assertOne(await run([added('fc_x', 'fc_c1'), delta('fc_x', '{"a":1}'), done({ call_id: 'fc_c1', arguments: '{"a":1}' }), completed([fcall({ call_id: 'fc_c1', arguments: '{"a":1}' })])]), 'fc_c1', '{"a":1}', 'B');
});

test('C delta com item_id diferente do added e do done, mesmo call_id', async () => {
  assertOne(await run([added('a', 'c1'), delta('b', '{"a":1}'), done({ id: 'c', call_id: 'c1', arguments: '{"a":1}' }, 0), completed([fcall({ id: 'c', call_id: 'c1', arguments: '{"a":1}' })])]), 'c1', '{"a":1}', 'C');
});

test('C2 delta que só traz call_id, sem índice e com item_id novo', async () => {
  const d = { type: 'response.function_call_arguments.delta', item_id: 'zzz', call_id: 'c1', delta: '{"a":1}' };
  assertOne(await run([added('a', 'c1'), d, done({ id: 'a', call_id: 'c1' }, 0), completed([fcall({ id: 'a', call_id: 'c1', arguments: '' })])]), 'c1', '{"a":1}', 'C2');
});

test('D done repetido emite uma vez', async () => {
  const item = { id: 'fc1', call_id: 'c1', arguments: '{"a":1}' };
  assertOne(await run([added('fc1', 'c1'), done(item, 0), done(item, 0), completed()]), 'c1', '{"a":1}', 'D');
});

test('E done sem argumentos e o final traz os argumentos: emite os do final', async () => {
  assertOne(await run([added('fc1', 'c1'), done({ id: 'fc1', call_id: 'c1' }, 0), completed([fcall({ id: 'fc1', call_id: 'c1', arguments: '{"a":1}' })])]), 'c1', '{"a":1}', 'E');
});

test('F id e call_id mudam entre o done e o final: sem emissão dupla', async () => {
  assertOne(await run([added('fc1', 'c1'), done({ id: 'fc1', call_id: 'c1', arguments: '{"a":1}' }, 0), completed([fcall({ id: 'other', call_id: 'c2', arguments: '{"a":1}' })])]), 'c1', '{"a":1}', 'F');
});

test('G done com id novo e sem call_id (mesmo índice)', async () => {
  assertOne(await run([added('a', 'c1'), delta('a', '{"a":1}'), done({ id: 'z', arguments: '{"a":1}' }, 0), completed([fcall({ id: 'z', call_id: 'c1', arguments: '{"a":1}' })])]), 'c1', '{"a":1}', 'G');
});

test('G2 done com id novo, sem call_id e sem índice', async () => {
  assertOne(await run([added('a', 'c1'), delta('a', '{"a":1}'), done({ id: 'z', arguments: '{"a":1}' }), completed([fcall({ id: 'z', arguments: '{"a":1}' })])]), 'c1', '{"a":1}', 'G2');
});

test('H done sem nenhum identificador', async () => {
  assertOne(await run([added('a', 'c1'), delta('a', '{"a":1}'), done({ arguments: '{"a":1}' }), completed()]), 'c1', '{"a":1}', 'H');
});

test('H2 done e final sem nenhum identificador', async () => {
  assertOne(await run([added('a', 'c1'), delta('a', '{"a":1}'), done({ arguments: '{"a":1}' }), completed([fcall({ arguments: '{"a":1}' })])]), 'c1', '{"a":1}', 'H2');
});

test('I duas chamadas paralelas, done sem id nem índice', async () => {
  const r = await run([added('a', 'c1', 0), added('b', 'c2', 1), delta('a', '{"x":1}', 0), delta('b', '{"y":2}', 1), done({ call_id: 'c1', arguments: '{"x":1}' }), done({ call_id: 'c2', arguments: '{"y":2}' }), completed([fcall({ call_id: 'c1', arguments: '{"x":1}' }), fcall({ call_id: 'c2', arguments: '{"y":2}' })])]);
  assert.equal(r.error, null);
  assert.deepEqual(r.calls.map((c) => [c.id, c.arguments]), [['c1', '{"x":1}'], ['c2', '{"y":2}']]);
});

test('I2 duas chamadas paralelas sem nenhum identificador no done nem no final', async () => {
  const r = await run([added('a', 'c1', 0), added('b', 'c2', 1), delta('a', '{"x":1}', 0), delta('b', '{"y":2}', 1), done({ arguments: '{"x":1}' }), done({ arguments: '{"y":2}' }), completed([fcall({ arguments: '{"x":1}' }), fcall({ arguments: '{"y":2}' })])]);
  assert.equal(r.error, null);
  assert.deepEqual(r.calls.map((c) => [c.id, c.arguments]), [['c1', '{"x":1}'], ['c2', '{"y":2}']]);
});

test('I3 duas chamadas, a segunda só no final (sem added nem done)', async () => {
  const r = await run([added('a', 'c1', 0), done({ id: 'a', call_id: 'c1', arguments: '{"x":1}' }, 0), completed([fcall({ id: 'a', call_id: 'c1', arguments: '{"x":1}' }), fcall({ id: 'b', call_id: 'c2', arguments: '{"y":2}' })])]);
  assert.equal(r.error, null);
  assert.deepEqual(r.calls.map((c) => [c.id, c.arguments]), [['c1', '{"x":1}'], ['c2', '{"y":2}']]);
});

test('J corte: chamada aberta e incomplete, sem nada, dá upstream', async () => {
  const r = await run([added('a', 'c1'), incomplete()]);
  assert.equal(r.error?.type, 'upstream');
  assert.match(r.error.message, /cortada/);
});

test('K corte: done vazio e o final traz os argumentos completos: emite', async () => {
  assertOne2(await run([added('a', 'c1'), done({ id: 'a', call_id: 'c1' }, 0), incomplete([fcall({ id: 'a', call_id: 'c1', arguments: '{"a":1}' })])]), 'c1', '{"a":1}', 'length');
});

/** Como assertOne, mas com o fim `length` do corte. */
function assertOne2(r, id, args, finish) {
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.calls.map((c) => [c.id, c.arguments]), [[id, args]]);
  assert.equal(r.finish, finish);
}

test('L corte: JSON parcial nos deltas e nada mais dá upstream "cortada"', async () => {
  const r = await run([added('a', 'c1'), delta('a', '{"a":'), incomplete()]);
  assert.equal(r.error?.type, 'upstream');
  assert.match(r.error.message, /cortada/);
});

test('M corte: item final com arguments vazio dá upstream "cortada pelo limite"', async () => {
  const r = await run([added('a', 'c1'), incomplete([fcall({ id: 'a', call_id: 'c1', arguments: '' })])]);
  assert.equal(r.error?.type, 'upstream');
  assert.match(r.error.message, /cortada pelo limite, sem argumentos/);
});

test('N corte: a primeira chamada sai, a segunda sem argumentos dá upstream', async () => {
  const r = await run([added('a', 'c1', 0), done({ id: 'a', call_id: 'c1', arguments: '{"a":1}' }, 0), incomplete([fcall({ id: 'a', call_id: 'c1', arguments: '{"a":1}' }), fcall({ id: 'b', call_id: 'c2', arguments: '' })])]);
  assert.deepEqual(r.calls.map((c) => c.id), ['c1']);
  assert.equal(r.error?.type, 'upstream');
  assert.match(r.error.message, /cortada/);
  assert.equal(r.error.emitted, true);
});

test('O arguments que vem como objeto vira JSON', async () => {
  assertOne(await run([added('a', 'c1'), done({ id: 'a', call_id: 'c1', arguments: { a: 1 } }, 0), completed([fcall({ id: 'a', call_id: 'c1', arguments: { a: 1 } })])]), 'c1', '{"a":1}', 'O');
});

test('O2 arguments objeto só no item final', async () => {
  assertOne(await run([added('a', 'c1'), done({ id: 'a', call_id: 'c1' }, 0), completed([fcall({ id: 'a', call_id: 'c1', arguments: { b: [1, 2] } })])]), 'c1', '{"b":[1,2]}', 'O2');
});

test('P delta antes do added (só índice)', async () => {
  assertOne(await run([delta(undefined, '{"a":1}'), added('a', 'c1'), done({ id: 'a', call_id: 'c1' }, 0), completed([fcall({ id: 'a', call_id: 'c1', arguments: '' })])]), 'c1', '{"a":1}', 'P');
});

test('Q só deltas, final com arguments vazio e sem call_id', async () => {
  assertOne(await run([delta('a', '{"a":1}'), completed([fcall({ id: 'a', arguments: '' })])]), 'a', '{"a":1}', 'Q');
});

test('S done vazio e final com ids novos e argumentos: uma chamada só', async () => {
  assertOne(await run([added('a', 'c1'), done({ id: 'a', call_id: 'c1' }, 0), completed([fcall({ id: 'x', call_id: 'c9', arguments: '{"a":1}' })])]), 'c1', '{"a":1}', 'S');
});

test('sem argumento nenhum em lugar nenhum: completed emite {} (uma vez)', async () => {
  assertOne(await run([added('a', 'c1'), done({ id: 'a', call_id: 'c1', arguments: '' }, 0), completed([fcall({ id: 'a', call_id: 'c1', arguments: '' })])]), 'c1', '{}', 'sem args');
  assertOne(await run([added('a', 'c1'), done({ id: 'a', call_id: 'c1' }, 0), completed()]), 'c1', '{}', 'sem args, final vazio');
});

test('registro nunca fechado: com argumentos e nome emite; sem nome ou com JSON inválido dá upstream', async () => {
  assertOne(await run([added('a', 'c1'), delta('a', '{"a":1}'), completed()]), 'c1', '{"a":1}', 'nunca fechado');
  const noName = await run([{ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'a', call_id: 'c1', arguments: '' } }, delta('a', '{"a":1}'), completed()]);
  assert.equal(noName.error?.type, 'upstream');
  const bad = await run([added('a', 'c1'), delta('a', '{"a":'), completed()]);
  assert.equal(bad.error?.type, 'upstream');
  assert.match(bad.error.message, /cortada/);
  const open = await run([added('a', 'c1'), completed()]);
  assert.equal(open.error?.type, 'upstream');
});

test('delta órfão (item_id desconhecido, sem índice e sem call_id) é adotado pela chamada sem argumentos', async () => {
  assertOne(await run([added('a', 'c1'), { type: 'response.function_call_arguments.delta', item_id: 'zzz', delta: '{"a":1}' }, done({ id: 'a', call_id: 'c1' }, 0), completed()]), 'c1', '{"a":1}', 'órfão');
});

test('duas chamadas com o mesmo nome e argumentos iguais, ids distintos: duas saídas', async () => {
  const r = await run([added('a', 'c1', 0), added('b', 'c2', 1), done({ id: 'a', call_id: 'c1', arguments: '{"a":1}' }, 0), done({ id: 'b', call_id: 'c2', arguments: '{"a":1}' }, 1), completed([fcall({ id: 'a', call_id: 'c1', arguments: '{"a":1}' }), fcall({ id: 'b', call_id: 'c2', arguments: '{"a":1}' })])]);
  assert.equal(r.error, null);
  assert.deepEqual(r.calls.map((c) => c.id), ['c1', 'c2']);
});

test('M9: texto só no item final sai como text; com texto já em stream, não duplica', async () => {
  const msg = { type: 'message', content: [{ type: 'output_text', text: 'oi' }] };
  const only = await run([completed([msg])]);
  assert.deepEqual(only.out.filter((e) => e.type === 'text'), [{ type: 'text', text: 'oi' }]);
  assert.equal(only.finish, 'stop');
  const streamed = await run([{ type: 'response.output_text.delta', delta: 'oi' }, completed([msg])]);
  assert.deepEqual(streamed.out.filter((e) => e.type === 'text'), [{ type: 'text', text: 'oi' }]);
  const withCall = await run([added('a', 'c1'), done({ id: 'a', call_id: 'c1', arguments: '{}' }, 0), completed([msg, fcall({ id: 'a', call_id: 'c1', arguments: '{}' })])]);
  assert.deepEqual(withCall.out.map((e) => e.type), ['tool_call', 'text']); // a chamada saiu no done; o texto só existia no final
});

test('a mensagem de corte continua "tool call cortada" (a Ariadne compara por ela)', async () => {
  const bad = await run([added('a', 'c1'), done({ id: 'a', call_id: 'c1', arguments: '{"a":' }, 0), completed()]);
  assert.match(bad.error.message, /tool call cortada \(f, arguments não é JSON\)/);
  const cut = await run([added('a', 'c1'), incomplete([fcall({ id: 'a', call_id: 'c1', arguments: '' })])]);
  assert.match(cut.error.message, /tool call cortada pelo limite, sem argumentos \(f\)/);
});

// Cenários que o fuzz (identificadores perdidos ou trocados em cada evento) achou depois do primeiro desenho.

test('done repetido sem nenhum identificador não emite a chamada duas vezes', async () => {
  const r = await run([added('a', 'c1'), delta('a', '{"a":1}'), done({ arguments: '{"a":1}' }), done({ arguments: '{"a":1}' }), completed([fcall({ id: 'a', call_id: 'c1', arguments: '{"a":1}' })])]);
  assertOne(r, 'c1', '{"a":1}', 'repetido');
});

test('deltas em pedaços, um deles com item_id desconhecido: o fragmento órfão vai para a chamada que o contém', async () => {
  const d2 = { type: 'response.function_call_arguments.delta', item_id: 'zzz', delta: '":1}' };
  assertOne(await run([added('a', 'c1'), delta('a', '{"a'), d2, done({ id: 'a', call_id: 'c1', arguments: '{"a":1}' }, 0), completed()]), 'c1', '{"a":1}', 'fragmento');
  assertOne(await run([added('a', 'c1'), delta('a', '{"a'), d2, done({ arguments: '{"a":1}' }), completed()]), 'c1', '{"a":1}', 'fragmento, done sem id');
});

test('delta vazio não abre registro nem vira chamada sem fim', async () => {
  const empty = { type: 'response.function_call_arguments.delta', item_id: 'zzz', delta: '' };
  assertOne(await run([added('a', 'c1'), empty, done({ id: 'a', call_id: 'c1' }, 0), completed()]), 'c1', '{}', 'delta vazio');
});

test('duas chamadas iguais (mesmo nome e argumentos) com ids trocados em todo evento: duas saídas', async () => {
  const same = '{"x":1}';
  const r = await run([
    added('a', 'c1', 0), added('b', 'c2', 1),
    done({ id: 'a2', call_id: 'c1-novo', arguments: same }), done({ id: 'b2', call_id: 'c2-novo', arguments: same }),
    completed([fcall({ id: 'a3', arguments: same }), fcall({ id: 'b3', arguments: same })]),
  ]);
  assert.equal(r.error, null);
  assert.deepEqual(r.calls.map((c) => [c.id, c.arguments]), [['c1', same], ['c2', same]]);
});

test('palpite por posição não vence apelido provado: o done com ids novos não funde duas chamadas iguais', async () => {
  const same = '{"x":1}';
  // O done sem índice cai na chamada 1 por posição (as duas têm os mesmos argumentos). O item final, que traz o id
  // da chamada 2, não pode fundir as duas por causa do apelido que foi só palpite.
  const r = await run([
    added('a', 'c1', 0), delta('a', same, 0), added('b', 'c2', 1), delta('c2', same, 1),
    done({ id: 'b-novo', call_id: 'c2-novo', arguments: same }),
    completed([fcall({ id: 'a-novo', call_id: 'c1', arguments: '' }), fcall({ id: 'b', call_id: 'c2-novo', arguments: same })]),
  ]);
  assert.equal(r.error, null);
  assert.deepEqual(r.calls.map((c) => c.arguments), [same, same]);
});
