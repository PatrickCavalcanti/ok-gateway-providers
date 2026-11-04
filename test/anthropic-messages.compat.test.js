// Matriz de corpo do fio anthropic-messages: buildRequest direto, sem client nem fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCompat } from '../src/compat.js';
import { buildRequest, parseStream } from '../src/apis/anthropic-messages.js';

const account = { id: 'a', provider: 'anthropic', api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k' };
const model = { id: 'claude-haiku-4-5', operations: ['chat'], input: ['text', 'image'], output: ['text'] };

function build(request, { acc = account, mdl = model } = {}) {
  return buildRequest({ account: acc, model: mdl, compat: resolveCompat(acc, mdl), request, apiKey: 'k' });
}
const hi = [{ role: 'user', content: 'oi' }];

test('url sem barra final duplicada', () => {
  assert.equal(build({ messages: hi }).url, 'https://api.anthropic.com/v1/messages');
  assert.equal(build({ messages: hi }, { acc: { ...account, baseUrl: 'https://x.test/v1//' } }).url, 'https://x.test/v1/messages');
});

test('system em blocos com cache: ttl só quando 1h', () => {
  const { body } = build({
    system: [{ text: 'fixo', cache: { ttl: '1h' } }, { text: 'médio', cache: { ttl: '5m' } }, { text: 'sem ttl', cache: {} }, { text: 'livre' }],
    messages: hi,
  });
  assert.deepEqual(body.system, [
    { type: 'text', text: 'fixo', cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: 'médio', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'sem ttl', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'livre' },
  ]);
});

test('cacheMarker none: o cache é ignorado, em system e em partes', () => {
  const mdl = { ...model, compat: { cacheMarker: 'none' } };
  const { body } = build({
    system: [{ text: 'fixo', cache: { ttl: '1h' } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'a', cache: { ttl: '5m' } }] }],
  }, { mdl });
  assert.deepEqual(body.system, [{ type: 'text', text: 'fixo' }]);
  assert.deepEqual(body.messages[0].content, [{ type: 'text', text: 'a' }]);
});

test('parte de texto com cache recebe cache_control', () => {
  const { body } = build({ messages: [{ role: 'user', content: [{ type: 'text', text: 'grande', cache: { ttl: '1h' } }] }] });
  assert.deepEqual(body.messages[0].content, [{ type: 'text', text: 'grande', cache_control: { type: 'ephemeral', ttl: '1h' } }]);
});

test('tool_result agrupa tools seguidas e o user seguinte na mesma mensagem user', () => {
  const { body } = build({
    messages: [
      { role: 'user', content: 'faça' },
      { role: 'assistant', content: 'ok', toolCalls: [
        { id: 't1', name: 'a', arguments: '{"x":1}' }, { id: 't2', name: 'b', arguments: '' },
      ] },
      { role: 'tool', toolCallId: 't1', content: 'r1' },
      { role: 'tool', toolCallId: 't2', content: [{ type: 'text', text: 'r2' }] },
      { role: 'user', content: 'continue' },
    ],
  });
  assert.equal(body.messages.length, 3);
  assert.deepEqual(body.messages[1].content, [
    { type: 'text', text: 'ok' },
    { type: 'tool_use', id: 't1', name: 'a', input: { x: 1 } },
    { type: 'tool_use', id: 't2', name: 'b', input: {} },
  ]);
  assert.deepEqual(body.messages[2].content, [
    { type: 'tool_result', tool_use_id: 't1', content: 'r1' },
    { type: 'tool_result', tool_use_id: 't2', content: 'r2' },
    { type: 'text', text: 'continue' },
  ]);
});

test('tool_result com imagem vira lista de blocos', () => {
  const { body } = build({
    messages: [{ role: 'tool', toolCallId: 't1', content: [{ type: 'text', text: 'print' }, { type: 'image', url: 'https://x/a.png' }] }],
  });
  assert.deepEqual(body.messages[0].content[0].content, [
    { type: 'text', text: 'print' },
    { type: 'image', source: { type: 'url', url: 'https://x/a.png' } },
  ]);
});

test('arguments inválido é invalid_request claro', () => {
  for (const args of ['{quebrado', '[1,2]', '"texto"']) {
    assert.throws(
      () => build({ messages: [{ role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'a', arguments: args }] }] }),
      (e) => e.type === 'invalid_request' && e.retryOther === false && /arguments/.test(e.message) && /t1/.test(e.message),
    );
  }
});

test('mensagem tool sem toolCallId e mensagem vazia são invalid_request', () => {
  assert.throws(() => build({ messages: [{ role: 'tool', content: 'x' }] }), (e) => e.type === 'invalid_request');
  assert.throws(() => build({ messages: [{ role: 'user', content: '' }] }), (e) => e.type === 'invalid_request');
  assert.throws(() => build({ messages: [{ role: 'assistant', content: '' }] }), (e) => e.type === 'invalid_request');
});

test('thinking: effort define adaptive/disabled e output_config.effort', () => {
  const adaptive = build({ messages: hi, effort: 'medium' }).body;
  assert.deepEqual(adaptive.thinking, { type: 'adaptive' });
  assert.deepEqual(adaptive.output_config, { effort: 'medium' });

  const off = build({ messages: hi, effort: 'none' }).body;
  assert.deepEqual(off.thinking, { type: 'disabled' });
  assert.equal(off.output_config, undefined);

  const unset = build({ messages: hi }).body;
  assert.equal(unset.thinking, undefined);
  assert.equal(unset.output_config, undefined);
});

test('reasoningFormat none: effort não gera thinking', () => {
  const mdl = { ...model, compat: { reasoningFormat: 'none' } };
  const { body } = build({ messages: hi, effort: 'high' }, { mdl });
  assert.equal(body.thinking, undefined);
  assert.equal(body.output_config, undefined);
});

test('thinkingByDefault: max_tokens 16000, sem temperature, sem thinking sem effort', () => {
  const mdl = { ...model, id: 'claude-sonnet-5', compat: { thinkingByDefault: true } };
  const a = build({ messages: hi, temperature: 0.2 }, { mdl }).body;
  assert.equal(a.max_tokens, 16000);
  assert.equal(a.temperature, undefined);
  assert.equal(a.thinking, undefined);

  // effort 'none' desliga o thinking, mas o modelo que pensa por padrão segue recusando temperature (400).
  const b = build({ messages: hi, temperature: 0.2, effort: 'none' }, { mdl }).body;
  assert.deepEqual(b.thinking, { type: 'disabled' });
  assert.equal(b.temperature, undefined);
  // thinking desligado: o padrão volta a 1024.
  assert.equal(b.max_tokens, 1024);
});

test('temperature: entra sem thinking; sai com adaptive ou supportsTemperature false', () => {
  assert.equal(build({ messages: hi, temperature: 0.7 }).body.temperature, 0.7);
  assert.equal(build({ messages: hi, temperature: 0.7, effort: 'low' }).body.temperature, undefined);
  const mdl = { ...model, compat: { supportsTemperature: false } };
  assert.equal(build({ messages: hi, temperature: 0.7 }, { mdl }).body.temperature, undefined);
});

test('max_tokens: request > padrão; model.maxTokens do catálogo não entra', () => {
  const mdl = { ...model, maxTokens: 999 };
  assert.equal(build({ messages: hi, maxTokens: 50 }, { mdl }).body.max_tokens, 50);
  assert.equal(build({ messages: hi }, { mdl }).body.max_tokens, 1024);
  assert.equal(build({ messages: hi }).body.max_tokens, 1024);
});

test('max_tokens 16000 sempre que o thinking vai rodar, inclusive adaptive sem thinkingByDefault', () => {
  assert.equal(build({ messages: hi, effort: 'high' }).body.max_tokens, 16000);
  assert.equal(build({ messages: hi, effort: 'none' }).body.max_tokens, 1024);
  assert.equal(build({ messages: hi, effort: 'high', maxTokens: 300 }).body.max_tokens, 300);
  // sem reasoningFormat anthropic_thinking o thinking não roda
  const off = { ...model, compat: { reasoningFormat: 'none' } };
  assert.equal(build({ messages: hi, effort: 'high' }, { mdl: off }).body.max_tokens, 1024);
  // thinkingByDefault com effort pedido
  const def = { ...model, compat: { thinkingByDefault: true } };
  assert.equal(build({ messages: hi, effort: 'low' }, { mdl: def }).body.max_tokens, 16000);
});

test('cache_control em parte de tool vai para o bloco tool_result', () => {
  const msgs = (content) => [
    { role: 'user', content: 'x' },
    { role: 'assistant', content: 'ok', toolCalls: [{ id: 't1', name: 'a', arguments: '{}' }] },
    { role: 'tool', toolCallId: 't1', content },
  ];
  const tr = (body) => body.messages[2].content[0];
  const a = tr(build({ messages: msgs([{ type: 'text', text: 'r', cache: { ttl: '1h' } }]) }).body);
  assert.deepEqual(a, { type: 'tool_result', tool_use_id: 't1', content: 'r', cache_control: { type: 'ephemeral', ttl: '1h' } });
  const b = tr(build({ messages: msgs([{ type: 'text', text: 'r', cache: {} }]) }).body);
  assert.deepEqual(b.cache_control, { type: 'ephemeral' });
  assert.equal(tr(build({ messages: msgs([{ type: 'text', text: 'r' }]) }).body).cache_control, undefined);
  const mdl = { ...model, compat: { cacheMarker: 'none' } };
  assert.equal(tr(build({ messages: msgs([{ type: 'text', text: 'r', cache: {} }]) }, { mdl }).body).cache_control, undefined);
});

test('entrada malformada: invalid_request com retryOther false', () => {
  const bad = (request, re) => assert.throws(() => build(request), (e) => {
    assert.equal(e.type, 'invalid_request');
    assert.equal(e.retryOther, false);
    assert.match(e.message, re);
    return true;
  });
  bad({ messages: [{ role: 'user' }] }, /content precisa ser string ou lista/);
  bad({ messages: [{ role: 'user', content: 5 }] }, /content precisa ser string ou lista/);
  bad({ messages: [{ role: 'user', content: [null] }] }, /parte malformada/);
  bad({ messages: [null] }, /mensagem malformada/);
  bad({ messages: 'oi' }, /messages precisa ser uma lista/);
  bad({ messages: [{ role: 'system', content: 'x' }] }, /não suportado/);
  bad({ messages: [{ role: 'tool', toolCallId: 't', content: undefined }] }, /content precisa ser string ou lista/);
  const asst = (toolCalls) => ({ messages: [{ role: 'assistant', content: '', toolCalls }] });
  bad(asst('x'), /toolCalls precisa ser uma lista/);
  bad(asst([null]), /tool_call malformado/);
  bad(asst([{ id: 't', arguments: '{}' }]), /precisa de name/);
  bad(asst([{ name: 'a', arguments: '{}' }]), /precisa de id/);
  bad(asst([{ id: 't', name: 'a', arguments: '{oops' }]), /não é um objeto JSON válido/);
  bad(asst([{ id: 't', name: 'a', arguments: '[1]' }]), /não é um objeto JSON válido/);
});

test('structuredOutput: output_config monta o formato; none (e outros) dá unsupported', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } } };
  const ok = build({ messages: hi, responseSchema: { schema }, effort: 'low' }).body;
  assert.deepEqual(ok.output_config, { effort: 'low', format: { type: 'json_schema', schema } });

  for (const value of ['none', 'response_format']) {
    const mdl = { ...model, compat: { structuredOutput: value } };
    assert.throws(
      () => build({ messages: hi, responseSchema: { schema } }, { mdl }),
      (e) => e.type === 'unsupported' && e.retryOther === true,
    );
  }
});

test('params: modelo e depois chamada, sem sobrescrever os protegidos', () => {
  const mdl = { ...model, params: { top_k: 5, metadata: { user_id: 'm' }, model: 'x', stream: false } };
  const { body } = build({
    messages: hi,
    tools: [{ name: 't', parameters: { type: 'object' } }],
    params: { top_k: 9, tool_choice: { type: 'any' }, messages: [], system: 'x', tools: [], max_tokens: 77 },
  }, { mdl });
  assert.equal(body.model, 'claude-haiku-4-5');
  assert.equal(body.stream, true);
  assert.equal(body.top_k, 9);
  assert.deepEqual(body.metadata, { user_id: 'm' });
  assert.deepEqual(body.tool_choice, { type: 'any' });
  assert.equal(body.messages.length, 1);
  assert.equal(body.system, undefined);
  assert.equal(body.tools.length, 1);
  assert.equal(body.max_tokens, 77);
});

test('parseStream: SSE com JSON quebrado é upstream', async () => {
  async function* events() { yield { event: 'message_start', data: '{nao-json' }; }
  const gen = parseStream(events(), { account, model, compat: resolveCompat(account, model) });
  await assert.rejects(gen.next(), (e) => e.type === 'upstream' && /JSON inválido/.test(e.message));
});

test('cachedContent é do Gemini: aqui dá unsupported, antes do fetch', () => {
  assert.throws(
    () => build({ messages: hi, cachedContent: 'cachedContents/abc' }),
    (e) => e.name === 'ProviderError' && e.type === 'unsupported' && e.retryOther === true,
  );
});
