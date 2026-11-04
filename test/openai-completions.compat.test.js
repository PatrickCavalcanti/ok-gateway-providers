// Matriz de compat: o mesmo pedido, com compat diferente, gera o corpo esperado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest } from '../src/apis/openai-completions.js';
import { resolveCompat } from '../src/compat.js';
import { ProviderError } from '../src/errors.js';

const baseAccount = { id: 'a', provider: 'acme', api: 'openai-completions', baseUrl: 'https://acme.test/v1', apiKey: 'k' };
const baseModel = { id: 'acme/m1', operations: ['chat'], input: ['text'], output: ['text'] };

/** Monta com o compat resolvido, como o cliente faz. */
function build({ account = {}, model = {}, request = {}, apiKey = 'k' } = {}) {
  const acc = { ...baseAccount, ...account };
  const mod = { ...baseModel, ...model };
  const req = { messages: [{ role: 'user', content: 'oi' }], ...request };
  return buildRequest({ account: acc, model: mod, compat: resolveCompat(acc, mod), request: req, apiKey });
}

const schema = { type: 'object', properties: { a: { type: 'string' } } };

test('conta genérica: conservadora, só o essencial no corpo', () => {
  const { url, headers, body } = build({ request: { system: 'seja breve', maxTokens: 100, temperature: 0.2 } });
  assert.equal(url, 'https://acme.test/v1/chat/completions');
  assert.equal(headers.Authorization, 'Bearer k');
  assert.deepEqual(body, {
    model: 'acme/m1',
    messages: [{ role: 'system', content: 'seja breve' }, { role: 'user', content: 'oi' }],
    stream: true,
    max_tokens: 100,
    temperature: 0.2,
  });
});

test('baseUrl com barras no fim e chave vazia (sem Authorization)', () => {
  const { url, headers } = build({ account: { baseUrl: 'http://localhost:11434/v1//' }, apiKey: '' });
  assert.equal(url, 'http://localhost:11434/v1/chat/completions');
  assert.equal('Authorization' in headers, false);
});

test('maxTokensField: max_completion_tokens / max_output_tokens; só o que o pedido traz, nunca o teto do modelo', () => {
  let { body } = build({ account: { compat: { maxTokensField: 'max_completion_tokens' } }, model: { maxTokens: 4096 }, request: { maxTokens: 77 } });
  assert.equal(body.max_completion_tokens, 77);
  assert.equal('max_tokens' in body, false);
  ({ body } = build({ model: { maxTokens: 4096 } }));
  assert.equal('max_tokens' in body, false);
  ({ body } = build({ model: { compat: { maxTokensField: 'max_output_tokens' } }, request: { maxTokens: 50 } }));
  assert.equal(body.max_output_tokens, 50);
  ({ body } = build());
  assert.equal('max_tokens' in body, false); // nem pedido nem modelo: não inventa
});

test('supportsDeveloperRole troca o papel do system', () => {
  assert.equal(build({ request: { system: 's' } }).body.messages[0].role, 'system');
  assert.equal(build({ account: { compat: { supportsDeveloperRole: true } }, request: { system: 's' } }).body.messages[0].role, 'developer');
});

test('supportsStore e usageInStream', () => {
  const off = build().body;
  assert.equal('store' in off, false);
  assert.equal('stream_options' in off, false);
  const on = build({ account: { compat: { supportsStore: true, usageInStream: true } } }).body;
  assert.equal(on.store, false);
  assert.deepEqual(on.stream_options, { include_usage: true });
});

test('supportsTemperature false omite a temperatura', () => {
  assert.equal(build({ request: { temperature: 0.7 } }).body.temperature, 0.7);
  assert.equal('temperature' in build({ model: { compat: { supportsTemperature: false } }, request: { temperature: 0.7 } }).body, false);
});

test('structuredOutput: response_format · top_level_json_schema · none (erro)', () => {
  const request = { responseSchema: { schema } };
  let { body } = build({ account: { compat: { structuredOutput: 'response_format' } }, request });
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'response', strict: true, schema } });
  assert.equal('json_schema' in body, false);

  ({ body } = build({
    account: { compat: { structuredOutput: 'response_format' } },
    request: { responseSchema: { name: 'ficha', strict: false, schema } },
  }));
  assert.deepEqual(body.response_format.json_schema, { name: 'ficha', strict: false, schema });

  ({ body } = build({ account: { compat: { structuredOutput: 'top_level_json_schema' } }, request }));
  assert.deepEqual(body.json_schema, schema);
  assert.equal('response_format' in body, false);

  for (const structuredOutput of ['none', 'output_config']) {
    assert.throws(
      () => build({ account: { compat: { structuredOutput } }, request }),
      (e) => e instanceof ProviderError && e.type === 'unsupported' && e.retryOther === true,
      structuredOutput,
    );
  }
  // sem schema pedido, nada sai e nada falha
  const plain = build({ account: { compat: { structuredOutput: 'none' } } }).body;
  assert.equal('response_format' in plain, false);
});

test('reasoningFormat: reasoning_effort · reasoning_object · none (ignora sem erro)', () => {
  const request = { effort: 'high' };
  assert.equal(build({ account: { compat: { reasoningFormat: 'reasoning_effort' } }, request }).body.reasoning_effort, 'high');
  const obj = build({ account: { compat: { reasoningFormat: 'reasoning_object' } }, request }).body;
  assert.deepEqual(obj.reasoning, { effort: 'high' });
  assert.equal('reasoning_effort' in obj, false);
  const none = build({ request }).body; // padrão 'none'
  assert.equal('reasoning' in none || 'reasoning_effort' in none, false);
  assert.throws(
    () => build({ account: { compat: { reasoningFormat: 'anthropic_thinking' } }, request }),
    (e) => e.type === 'unsupported',
  );
  // sem effort pedido, nada sai
  assert.equal('reasoning_effort' in build({ account: { compat: { reasoningFormat: 'reasoning_effort' } } }).body, false);
});

test('cacheMarker cache_control marca system e partes de texto; none não leva a marca', () => {
  const request = {
    system: [{ text: 'regras', cache: { ttl: '1h' } }, { text: 'tom' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'contexto', cache: {} }, { type: 'text', text: 'pergunta' }] }],
  };
  const on = build({ account: { compat: { cacheMarker: 'cache_control' } }, request }).body.messages;
  assert.deepEqual(on[0].content, [
    { type: 'text', text: 'regras', cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: 'tom' },
  ]);
  assert.deepEqual(on[1].content, [
    { type: 'text', text: 'contexto', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'pergunta' },
  ]);
  const off = build({ request }).body.messages;
  assert.equal(off[0].content, 'regrastom'); // sem separador: o texto original do chamador
  assert.equal(JSON.stringify(off).includes('cache_control'), false);
  // várias partes de texto ficam lista: colar juntaria palavras
  assert.deepEqual(off[1].content, [{ type: 'text', text: 'contexto' }, { type: 'text', text: 'pergunta' }]);
});

test('cacheMarker prompt_cache_breakpoint marca system, user e tool', () => {
  const request = {
    system: [{ text: 'regras', cache: {} }, { text: 'tom' }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'contexto', cache: { ttl: '1h' } }, { type: 'text', text: 'pergunta' }] },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'f', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'resultado', cache: {} }] },
      { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    ],
  };
  const m = build({ account: { compat: { cacheMarker: 'prompt_cache_breakpoint' } }, request }).body.messages;
  const bp = { prompt_cache_breakpoint: { mode: 'explicit' } };
  assert.deepEqual(m[0].content, [{ type: 'text', text: 'regras', ...bp }, { type: 'text', text: 'tom' }]);
  assert.deepEqual(m[1].content, [{ type: 'text', text: 'contexto', ...bp }, { type: 'text', text: 'pergunta' }]);
  assert.deepEqual(m[3].content, [{ type: 'text', text: 'resultado', ...bp }]);
  assert.equal(m[4].content, 'ab'); // sem marca, continua string
  assert.equal(JSON.stringify(m).includes('cache_control'), false);
});

test('cacheMarker cache_control também marca mensagem tool; none descarta a marca', () => {
  const request = { messages: [{ role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'r', cache: {} }] }] };
  assert.deepEqual(build({ account: { compat: { cacheMarker: 'cache_control' } }, request }).body.messages[0].content, [{ type: 'text', text: 'r', cache_control: { type: 'ephemeral' } }]);
  assert.equal(build({ request }).body.messages[0].content, 'r');
});

test('user com uma parte só de texto e sem marca vai como string; várias ou com mídia seguem lista', () => {
  const text = [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }];
  assert.equal(build({ request: { messages: [{ role: 'user', content: [text[0]] }] } }).body.messages[0].content, 'a');
  assert.deepEqual(build({ request: { messages: [{ role: 'user', content: text }] } }).body.messages[0].content, text);
  const img = { type: 'image', data: 'QUJD', mime: 'image/png' };
  const out = build({ model: { input: ['text', 'image'] }, request: { messages: [{ role: 'user', content: [text[0], img] }] } }).body.messages[0].content;
  assert.equal(Array.isArray(out), true);
});

test('providerRouting + responseSchema: require_parameters mesclado em provider', () => {
  const request = { responseSchema: { schema } };
  const account = { compat: { providerRouting: true, structuredOutput: 'response_format' } };
  assert.deepEqual(build({ account, request }).body.provider, { require_parameters: true });
  assert.deepEqual(build({ account, request: { ...request, params: { provider: { order: ['x'] } } } }).body.provider, { order: ['x'], require_parameters: true });
  assert.equal('provider' in build({ account, request: hello0() }).body, false); // sem schema, nada
  assert.equal('provider' in build({ account: { compat: { structuredOutput: 'response_format' } }, request }).body, false); // sem providerRouting
});
function hello0() { return {}; }

test('params: modelo, depois a chamada; chaves do fio ficam protegidas', () => {
  const { body } = build({
    account: { compat: { usageInStream: true, structuredOutput: 'response_format' } },
    model: { params: { top_p: 0.9, seed: 1, model: 'outro', messages: [], stream: false } },
    request: {
      responseSchema: { schema },
      tools: [{ name: 't', parameters: { type: 'object' } }],
      params: { seed: 2, top_k: 40, tools: [], response_format: { type: 'text' }, stream_options: { x: 1 } },
    },
  });
  assert.equal(body.top_p, 0.9);
  assert.equal(body.seed, 2); // a chamada vence o modelo
  assert.equal(body.top_k, 40);
  assert.equal(body.model, 'acme/m1');
  assert.equal(body.stream, true);
  assert.equal(body.messages.length, 1);
  assert.equal(body.tools.length, 1);
  assert.equal(body.response_format.type, 'json_schema');
  assert.deepEqual(body.stream_options, { include_usage: true });
});

test('params.provider só passa com providerRouting', () => {
  const params = { provider: { order: ['deepinfra'], allow_fallbacks: false } };
  assert.equal('provider' in build({ request: { params } }).body, false);
  assert.deepEqual(build({ account: { compat: { providerRouting: true } }, request: { params } }).body.provider, params.provider);
  assert.deepEqual(build({ account: { compat: { providerRouting: true } }, model: { params } }).body.provider, params.provider);
  assert.equal('provider' in build({ model: { params } }).body, false);
});

test('compat do modelo vence o da conta, campo a campo', () => {
  const { body } = build({
    account: { compat: { maxTokensField: 'max_completion_tokens', supportsDeveloperRole: true } },
    model: { compat: { maxTokensField: 'max_tokens' } },
    request: { system: 's', maxTokens: 9 },
  });
  assert.equal(body.max_tokens, 9);
  assert.equal(body.messages[0].role, 'developer'); // herdado da conta
});

test('mensagens: assistant com tool_calls, papel tool e tools no formato function', () => {
  const { body } = build({
    request: {
      tools: [{ name: 'soma', parameters: { type: 'object' } }],
      messages: [
        { role: 'user', content: 'quanto é 1+1?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'soma', arguments: '{"a":1,"b":1}' }] },
        { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: '2' }] },
      ],
    },
  });
  assert.deepEqual(body.tools, [{ type: 'function', function: { name: 'soma', parameters: { type: 'object' } } }]);
  assert.deepEqual(body.messages[1], {
    role: 'assistant', content: '',
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'soma', arguments: '{"a":1,"b":1}' } }],
  });
  assert.deepEqual(body.messages[2], { role: 'tool', tool_call_id: 'c1', content: '2' });
  assert.throws(
    () => build({ request: { messages: [{ role: 'tool', content: 'x' }] } }),
    (e) => e.type === 'invalid_request' && e.retryOther === false,
  );
});

test('mídia em assistant/tool dá unsupported (mídia só vai em user)', () => {
  const part = { type: 'image', data: 'AAA', mime: 'image/png' };
  for (const role of ['assistant', 'tool']) {
    assert.throws(
      () => build({ model: { input: ['text', 'image'] }, request: { messages: [{ role, toolCallId: 'x', content: [part] }] } }),
      (e) => e.type === 'unsupported',
      role,
    );
  }
});

test('cachedContent é do Gemini: aqui dá unsupported, antes do fetch', () => {
  assert.throws(
    () => build({ request: { cachedContent: 'cachedContents/abc' } }),
    (e) => e instanceof ProviderError && e.type === 'unsupported' && e.retryOther === true,
  );
});

// ---------------------------------------------------------------------------------------
// T1.2 · Fase 4 · Task 4.1 — toolChoice, stop, reasoning e isError

const tools = [{ name: 'soma', parameters: { type: 'object' } }];

test('toolChoice: auto · none · required · { name } viram tool_choice do fio', () => {
  const choice = (toolChoice) => build({ request: { tools, toolChoice } }).body.tool_choice;
  assert.equal(choice('auto'), 'auto');
  assert.equal(choice('none'), 'none');
  assert.equal(choice('required'), 'required');
  assert.deepEqual(choice({ name: 'soma' }), { type: 'function', function: { name: 'soma' } });
  assert.equal('tool_choice' in build({ request: { tools } }).body, false); // sem pedido, nada sai
});

test('toolChoice sem tools, ou com valor que não existe, é invalid_request sem outro alvo', () => {
  const invalid = (e) => e instanceof ProviderError && e.type === 'invalid_request' && e.retryOther === false;
  for (const toolChoice of ['auto', 'none', 'required', { name: 'soma' }]) {
    assert.throws(() => build({ request: { toolChoice } }), invalid, `sem tools: ${JSON.stringify(toolChoice)}`);
    assert.throws(() => build({ request: { tools: [], toolChoice } }), invalid, `tools vazio: ${JSON.stringify(toolChoice)}`);
  }
  for (const toolChoice of ['sempre', {}, { name: '' }, { name: 3 }, null, 7]) {
    assert.throws(() => build({ request: { tools, toolChoice } }), invalid, `valor: ${JSON.stringify(toolChoice)}`);
  }
});

test('stop vai como stop; lista vazia não vai; valor fora de lista de textos é invalid_request', () => {
  assert.deepEqual(build({ request: { stop: ['FIM', '\n\n'] } }).body.stop, ['FIM', '\n\n']);
  assert.equal('stop' in build({ request: { stop: [] } }).body, false);
  assert.equal('stop' in build().body, false);
  for (const stop of ['FIM', [1], [null], {}]) {
    assert.throws(
      () => build({ request: { stop } }),
      (e) => e instanceof ProviderError && e.type === 'invalid_request' && e.retryOther === false,
      JSON.stringify(stop),
    );
  }
});

test('reasoning.maxTokens e exclude: só no formato reasoning_object; effort e maxTokens não vão juntos', () => {
  const account = { compat: { reasoningFormat: 'reasoning_object' } };
  assert.throws(() => build({ account, request: { effort: 'high', reasoning: { maxTokens: 2000 } } }), (e) => e.type === 'invalid_request' && e.retryOther === false);
  assert.deepEqual(build({ account, request: { effort: 'low', reasoning: { exclude: true } } }).body.reasoning, { effort: 'low', exclude: true });
  assert.deepEqual(build({ account, request: { reasoning: { maxTokens: 800 } } }).body.reasoning, { max_tokens: 800 }); // sem effort
  assert.deepEqual(build({ account, request: { reasoning: { exclude: false } } }).body.reasoning, { exclude: false });
  assert.equal('reasoning' in build({ account, request: { reasoning: {} } }).body, false); // objeto vazio não pede nada
  assert.deepEqual(build({ account, request: { effort: 'high' } }).body.reasoning, { effort: 'high' }); // o caminho antigo segue
  for (const reasoningFormat of ['reasoning_effort', 'none', 'anthropic_thinking']) {
    for (const reasoning of [{ maxTokens: 100 }, { exclude: true }]) {
      assert.throws(
        () => build({ account: { compat: { reasoningFormat } }, request: { effort: 'high', reasoning } }),
        (e) => e instanceof ProviderError && e.type === 'unsupported' && e.retryOther === true,
        `${reasoningFormat} ${JSON.stringify(reasoning)}`,
      );
    }
  }
  // reasoning vazio nos outros formatos não pede nada: não falha
  assert.equal('reasoning_effort' in build({ account: { compat: { reasoningFormat: 'reasoning_effort' } }, request: { reasoning: {} } }).body, false);
});

test('isError no papel tool: prefixo "Tool error: " no texto; sem a marca, nada muda', () => {
  const call = { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'soma', arguments: '{}' }] };
  const result = (extra, content = 'falhou') => build({ request: { tools, messages: [call, { role: 'tool', toolCallId: 'c1', content, ...extra }] } }).body.messages[1];
  assert.deepEqual(result({ isError: true }), { role: 'tool', tool_call_id: 'c1', content: 'Tool error: falhou' });
  assert.equal(result({ isError: false }).content, 'falhou');
  assert.equal(result({}).content, 'falhou');
  // partes de texto sem marca juntam-se; o prefixo vai uma vez só
  assert.equal(result({ isError: true }, [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]).content, 'Tool error: ab');
  // com marca de cache aceita pelo compat o conteúdo segue em lista: o prefixo vai na primeira parte e a marca fica
  const comMarca = build({
    account: { compat: { cacheMarker: 'cache_control' } },
    request: { tools, messages: [call, { role: 'tool', toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'x', cache: {} }, { type: 'text', text: 'y' }] }] },
  }).body.messages[1];
  assert.deepEqual(comMarca.content, [{ type: 'text', text: 'Tool error: x', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'y' }]);
  // sem cacheMarker a marca se perde e o conteúdo é string, com o prefixo
  assert.equal(result({ isError: true }, [{ type: 'text', text: 'x', cache: {} }, { type: 'text', text: 'y' }]).content, 'Tool error: xy');
  // resultado vazio com erro ainda diz que foi erro
  assert.equal(result({ isError: true }, '').content, 'Tool error: ');
  // isError fora do papel tool não faz nada
  assert.deepEqual(build({ request: { messages: [{ role: 'user', content: 'oi', isError: true }] } }).body.messages[0], { role: 'user', content: 'oi' });
});

// ---------------------------------------------------------------------------------------
// T1.2 · Fase 4 · Task 4.2 — raciocínio assinado: aqui a parte reasoning é ignorada de propósito

test('parte reasoning no papel assistant é ignorada: sem erro e fora do corpo, para o fallback entre modelos', () => {
  const { body } = build({
    request: {
      tools,
      messages: [
        { role: 'user', content: 'quanto é 1+1?' },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'preciso somar', signature: 'SIG-ANTHROPIC' },
            { type: 'text', text: 'vou ' },
            { type: 'reasoning', text: '', redacted: 'RED-ANTHROPIC' },
            { type: 'text', text: 'calcular' },
          ],
          toolCalls: [{ id: 'c1', name: 'soma', arguments: '{"a":1,"b":1}', providerData: { thoughtSignature: 'SIG-GEMINI' } }],
        },
        { role: 'tool', toolCallId: 'c1', content: '2' },
      ],
    },
  });
  assert.deepEqual(body.messages[1], {
    role: 'assistant', content: 'vou calcular',
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'soma', arguments: '{"a":1,"b":1}' } }],
  });
  const json = JSON.stringify(body);
  for (const vazou of ['SIG-ANTHROPIC', 'RED-ANTHROPIC', 'SIG-GEMINI', 'preciso somar', 'thoughtSignature', 'providerData', '"reasoning"']) {
    assert.equal(json.includes(vazou), false, vazou);
  }
});

test('assistant só com parte reasoning vira texto vazio, como um assistant sem texto', () => {
  const { body } = build({ request: { messages: [{ role: 'assistant', content: [{ type: 'reasoning', text: 'x', signature: 's' }], toolCalls: [{ id: 'c1', name: 'f', arguments: '{}' }] }] } });
  assert.deepEqual(body.messages[0], { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] });
});

test('com reasoningFormat e cacheMarker ligados, a parte reasoning do assistant continua fora do corpo', () => {
  const account = { compat: { reasoningFormat: 'reasoning_object', cacheMarker: 'cache_control' } };
  const { body } = build({ account, request: { messages: [{ role: 'assistant', content: [{ type: 'reasoning', text: 'x', signature: 's', cache: {} }, { type: 'text', text: 'ok', cache: {} }] }] } });
  assert.deepEqual(body.messages[0], { role: 'assistant', content: 'ok' });
});

test('parte reasoning no papel user é invalid_request: só o assistant guarda raciocínio', () => {
  const part = { type: 'reasoning', text: 'x', signature: 's' };
  assert.throws(
    () => build({ request: { messages: [{ role: 'user', content: [part, { type: 'text', text: 'oi' }] }] } }),
    (e) => e instanceof ProviderError && e.type === 'invalid_request' && e.retryOther === false,
  );
});

test('toolChoice e stop explícitos vencem params; sem eles, params passa', () => {
  const tools = [{ name: 't', parameters: { type: 'object', properties: {} } }];
  const a = build({ request: { tools, toolChoice: 'required', stop: ['A'], params: { tool_choice: 'none', stop: ['B'] } } }).body;
  assert.deepEqual([a.tool_choice, a.stop], ['required', ['A']]);
  const b = build({ request: { tools, params: { tool_choice: 'none', stop: ['B'] } } }).body;
  assert.deepEqual([b.tool_choice, b.stop], ['none', ['B']]);
});
