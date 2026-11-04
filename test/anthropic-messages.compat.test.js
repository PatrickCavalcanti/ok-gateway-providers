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

// ---------------------------------------------------------------------------------------
// T1.2 · Fase 4 · Task 4.1 — toolChoice, stop, reasoning e isError

const tools = [{ name: 'soma', parameters: { type: 'object' } }];

test('toolChoice: auto · none · required · { name } viram tool_choice do fio', () => {
  const choice = (toolChoice) => build({ messages: hi, tools, toolChoice }).body.tool_choice;
  assert.deepEqual(choice('auto'), { type: 'auto' });
  assert.deepEqual(choice('none'), { type: 'none' });
  assert.deepEqual(choice('required'), { type: 'any' });
  assert.deepEqual(choice({ name: 'soma' }), { type: 'tool', name: 'soma' });
  assert.equal('tool_choice' in build({ messages: hi, tools }).body, false);
});

test('toolChoice sem tools, ou com valor que não existe, é invalid_request sem outro alvo', () => {
  const invalid = (e) => e.name === 'ProviderError' && e.type === 'invalid_request' && e.retryOther === false;
  for (const toolChoice of ['auto', 'none', 'required', { name: 'soma' }]) {
    assert.throws(() => build({ messages: hi, toolChoice }), invalid, `sem tools: ${JSON.stringify(toolChoice)}`);
    assert.throws(() => build({ messages: hi, tools: [], toolChoice }), invalid, `tools vazio: ${JSON.stringify(toolChoice)}`);
  }
  for (const toolChoice of ['sempre', {}, { name: '' }, { name: 3 }, null, 7]) {
    assert.throws(() => build({ messages: hi, tools, toolChoice }), invalid, `valor: ${JSON.stringify(toolChoice)}`);
  }
});

test('stop vira stop_sequences; lista vazia não vai; valor fora de lista de textos é invalid_request', () => {
  assert.deepEqual(build({ messages: hi, stop: ['FIM', '###'] }).body.stop_sequences, ['FIM', '###']);
  assert.equal('stop_sequences' in build({ messages: hi, stop: [] }).body, false);
  assert.equal('stop_sequences' in build({ messages: hi }).body, false);
  for (const stop of ['FIM', [1], [null], {}]) {
    assert.throws(
      () => build({ messages: hi, stop }),
      (e) => e.name === 'ProviderError' && e.type === 'invalid_request' && e.retryOther === false,
      JSON.stringify(stop),
    );
  }
});

test('reasoning.maxTokens e exclude dão unsupported, com ou sem effort; reasoning vazio não pede nada', () => {
  for (const reasoning of [{ maxTokens: 1000 }, { exclude: true }, { exclude: false }, { maxTokens: 1000, exclude: true }]) {
    for (const effort of [undefined, 'high']) {
      assert.throws(
        () => build({ messages: hi, effort, reasoning }),
        (e) => e.name === 'ProviderError' && e.type === 'unsupported' && e.retryOther === true,
        `${effort} ${JSON.stringify(reasoning)}`,
      );
    }
  }
  const body = build({ messages: hi, effort: 'low', reasoning: {} }).body;
  assert.deepEqual(body.thinking, { type: 'adaptive' });
});

test('isError no papel tool vira is_error: true; sem a marca, o bloco fica como era', () => {
  const call = { role: 'assistant', content: 'ok', toolCalls: [{ id: 't1', name: 'soma', arguments: '{}' }, { id: 't2', name: 'soma', arguments: '{}' }] };
  const { body } = build({ messages: [call, { role: 'tool', toolCallId: 't1', content: 'falhou', isError: true }, { role: 'tool', toolCallId: 't2', content: 'ok', isError: false }] });
  assert.deepEqual(body.messages[1].content, [
    { type: 'tool_result', tool_use_id: 't1', content: 'falhou', is_error: true },
    { type: 'tool_result', tool_use_id: 't2', content: 'ok' },
  ]);
  const cache = build({ messages: [call, { role: 'tool', toolCallId: 't1', isError: true, content: [{ type: 'text', text: 'x', cache: {} }] }] }).body.messages[1].content[0];
  assert.deepEqual(cache, { type: 'tool_result', tool_use_id: 't1', content: 'x', is_error: true, cache_control: { type: 'ephemeral' } });
});

// ---------------------------------------------------------------------------------------
// T1.2 · Fase 4 · Task 4.2 — raciocínio assinado: volta antes do texto e das tool calls

test('parte reasoning assinada volta como thinking, e a redigida como redacted_thinking, antes do texto e das tool calls', () => {
  const { body } = build({
    messages: [
      { role: 'user', content: 'quanto é 1+1?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'vou calcular' },
          { type: 'reasoning', text: 'preciso somar', signature: 'SIG-1' },
          { type: 'reasoning', text: '', redacted: 'RED-1' },
        ],
        toolCalls: [{ id: 't1', name: 'soma', arguments: '{"a":1}', providerData: { thoughtSignature: 'SIG-GEMINI' } }],
      },
    ],
  });
  assert.deepEqual(body.messages[1].content, [
    { type: 'thinking', thinking: 'preciso somar', signature: 'SIG-1' },
    { type: 'redacted_thinking', data: 'RED-1' },
    { type: 'text', text: 'vou calcular' },
    { type: 'tool_use', id: 't1', name: 'soma', input: { a: 1 } }, // providerData não vai
  ]);
});

test('parte reasoning sem signature e sem redacted é ignorada: a API a recusaria', () => {
  const asst = (content, toolCalls) => build({ messages: [{ role: 'assistant', content, toolCalls }] }).body.messages[0].content;
  assert.deepEqual(asst([{ type: 'reasoning', text: 'pensei' }, { type: 'text', text: 'a' }]), [{ type: 'text', text: 'a' }]);
  assert.deepEqual(asst([{ type: 'reasoning', text: 'pensei', signature: '' }, { type: 'reasoning', text: '', redacted: '' }, { type: 'text', text: 'a' }]), [{ type: 'text', text: 'a' }]);
  assert.deepEqual(
    asst([{ type: 'reasoning', text: 'pensei' }], [{ id: 't1', name: 'f', arguments: '{}' }]),
    [{ type: 'tool_use', id: 't1', name: 'f', input: {} }],
  );
  // thinking de texto vazio com assinatura é legítimo (resumo omitido) e precisa voltar
  assert.deepEqual(asst([{ type: 'reasoning', text: '', signature: 'SIG' }, { type: 'text', text: 'a' }]), [{ type: 'thinking', thinking: '', signature: 'SIG' }, { type: 'text', text: 'a' }]);
  // cache não existe em thinking: a marca da parte não vai
  const cached = asst([{ type: 'reasoning', text: 'x', signature: 'S', cache: { ttl: '1h' } }, { type: 'text', text: 'a' }]);
  assert.equal(JSON.stringify(cached).includes('cache_control'), false);
});

test('parte reasoning fora do papel assistant é invalid_request (só o assistant guarda raciocínio)', () => {
  const part = { type: 'reasoning', text: 'x', signature: 's' };
  for (const messages of [
    [{ role: 'user', content: [part, { type: 'text', text: 'oi' }] }],
    [{ role: 'assistant', content: 'a', toolCalls: [{ id: 't1', name: 'f', arguments: '{}' }] }, { role: 'tool', toolCallId: 't1', content: [part] }],
  ]) {
    assert.throws(() => build({ messages }), (e) => e.type === 'invalid_request' && e.retryOther === false);
  }
});

test('toolChoice e stop explícitos vencem params', () => {
  const tools = [{ name: 't', parameters: { type: 'object', properties: {} } }];
  const account = { id: 'a', provider: 'anthropic', api: 'anthropic-messages', baseUrl: 'https://x/v1' };
  const model = { id: 'm', operations: ['chat'], input: ['text'], output: ['text'] };
  const { body } = buildRequest({ account, model, compat: resolveCompat(account, model), apiKey: 'k',
    request: { messages: [{ role: 'user', content: 'oi' }], tools, toolChoice: 'none', stop: ['A'], params: { tool_choice: { type: 'any' }, stop_sequences: ['B'] } } });
  assert.deepEqual([body.tool_choice, body.stop_sequences], [{ type: 'none' }, ['A']]);
});
