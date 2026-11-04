# ok-gateway-providers — T1.2 — Plano de implementação

> **Para quem executa:** este plano roda com `superpowers:subagent-driven-development`, orquestrado pela sessão que o escreveu. As etapas usam checkbox (`- [ ]`).

**Goal:** a lib ganha embeddings, STT, TTS, imagem e decisão, o fio `google-generative-ai`, o que falta no contrato de chat e fixtures reais. Sai como `v0.2.0`.

**Spec:** `docs/superpowers/specs/2026-11-03-lib-providers-t1.2-design.md`.

**Arquitetura:** operação além de chat é chamada única. O fio declara um módulo por operação, com `buildRequest` e `parseResponse`. O cliente faz o fetch, os prazos, o status, o custo e o erro.

**Tech stack:** Node ≥ 20.14, ESM, zero dependência de runtime, `node:test`, JSDoc com `checkJs`, `.d.ts` gerado.

**Branch:** `feature/t1.2` no clone `E:\Projetos\ok-gateway-providers`, criada de `main`. Só esta sessão usa esse clone, então não há worktree.

---

## Ajustes em relação à spec

1. **Arquivo no Gemini:** `transport.file` continua `('data-url'|'url')[]`, e `data-url` vira `inlineData` nesse fio. Só `audio` e `video` ganham o valor `inline_data`. A spec listava os três.
2. **`isError` fora da Anthropic e do Gemini:** o texto do resultado ganha o prefixo `Tool error: `. No Gemini vai em `functionResponse.response.error`.
3. **`openai-responses`:** a saída estruturada ganha o valor `text_format` em `compat.structuredOutput`. O padrão do fio continua conservador (`none`), e a conta oficial liga.
4. **`reasoning.maxTokens` e `exclude`:** só existem no formato `reasoning_object`. Em qualquer outro formato, dão `unsupported`.

### Ajustes durante a execução

5. **Fatos medidos na API real** (2026-11-04): o OpenRouter recusa `effort` e `reasoning.max_tokens` juntos, então a lib dá `invalid_request`. A Anthropic (Sonnet 5.5) recusa `tool_choice` `any` e `tool` com pensamento ligado: a lib manda, e o erro chega com `retryOther: true`.
6. **O que o pedido traz explícito vence `params`:** `toolChoice`, `stop`, `maxTokens`, `temperature`, `responseSchema`. Sem valor explícito, `params` passa.
7. **`openai-responses`:** reexporta as operações do `openai-completions`, porque as rotas não mudam na OpenAI. Aceita `top_level_json_schema` para o llama.cpp. `response.refusal.delta` vira texto, e o fim sai `content_filter`. `cache_write_tokens` sai do input, como no `openai-completions`. `supportsTemperature` nasce `false`.
8. **`toolName`** na mensagem `tool` e **resultados de tool seguidos num turno só** no Gemini.
9. **Catálogo:** o vocabulário real de saída do OpenRouter é `speech`, `transcription`, `decisions`, `rerank`, `video`. Os três primeiros viram operação; os outros, nenhuma.

10. **`openai-responses` saiu da `v0.2.0`** (revisões 1 e 2 do conjunto): o código fica em `feature/openai-responses` e volta com a E4. A Fase 5 não entra nesta tag.

---

## Mapa de quem faz

| Fase | Etapa | Quem faz | Por quê |
|---|---|---|---|
| 1 | Infraestrutura (Tasks 1.1–1.3) | `implementer-sonnet` | Mexe no cliente, de que tudo depende |
| 1 | Gravador (Task 1.4) | `implementer-haiku` | Script isolado e bem especificado |
| 1 | Revisão | `reviewer-gemini` | Outro fornecedor, cota folgada |
| 2 | Quatro operações (Tasks 2.1–2.4) | `implementer-deepseek` | Código completo no plano, arquivos separados, em paralelo |
| 2 | Catálogo (Task 2.5) | `implementer-gemini` | Mudança pequena e testada |
| 2 | Gravar fixtures (Task 2.6) | Controller | Precisa das chaves |
| 2 | Revisão | `reviewer-gemini` | Idem |
| 3 | Fio Google (Tasks 3.1–3.2) | `implementer-sonnet` | Fio novo, com conversões delicadas |
| 3 | Gravar fixtures (Task 3.3) | Controller | Precisa das chaves |
| 3 | Revisão | `reviewer-deepseek` | Outro fornecedor |
| 4 | Contrato de chat (Tasks 4.1–4.2) | `implementer-sonnet` | Toca os três fios, em sequência |
| 4 | Ciclo de tool com pensamento (Task 4.3) | Controller | Chamada real |
| 4 | Revisão | `reviewer-gemini` | Idem |
| 5 | Fio Responses (Task 5.1) | `implementer-sonnet` | Fio novo |
| 5 | Gravar fixtures (Task 5.2) | Controller | Precisa das chaves |
| 5 | Revisão | `reviewer-deepseek` | Idem |
| Fim | Smoke, tipos, README, CHANGELOG (Task 6.1) | Controller | Precisa das chaves |
| Fim | Revisão do conjunto | `reviewer-opus` | Modelo mais forte (gate) |
| Fim | Merge na `main` e tag `v0.2.0` (Task 6.2) | Controller | A T2.2 consome a tag |

Cota em 2026-11-04: Claude 12%, Gemini 13%, OpenCode 44% no mês e 1% na semana. **Codex em 76% na semana**, por isso fica fora do mapa. Subagente da CLI Claude roda pela ferramenta Agent.

---

## Regras para quem implementa

- Primeiro comando: `cd /e/Projetos/ok-gateway-providers && git rev-parse --show-toplevel && git branch --show-current`. A branch tem de ser `feature/t1.2`.
- **Passo zero:** confira no código os contratos abaixo. Se divergirem, devolva **BLOCKED** com o que achou.
- **Não commite.** Devolva os paths e a mensagem de commit. O controller commita com pathspec.
- Rode só os testes da task, em primeiro plano: `node --test --test-force-exit test/<arquivo>.test.js`. No fim: `npx tsc --noEmit -p tsconfig.json`.
- Sem dependência nova. Sem rede: teste injeta `fetch` falso.
- Proibido git destrutivo: `checkout --`, `checkout <sha> -- <path>`, `stash`, `reset`, `restore`, `clean`.
- Não mate processo por nome. Arquivo temporário vai em `e:\tmp\t12\`, nunca no repositório.
- Identificadores em inglês; comentários e mensagens de erro em português.
- Não há `if` por provedor nos fios: diferença de provedor é campo de `compat`.
- Texto do plano contradiz o critério de verificação: siga o critério e relate.
- Termine respondendo à pergunta de julgamento da task.

---

## Contratos (fixados na Fase 1)

### Tipos novos em `src/types.js`

```js
/**
 * O que `parseResponse` recebe. `json()` e `bytes()` leem o corpo uma vez só.
 * @typedef {object} OneShotResponse
 * @property {number} status
 * @property {Headers} headers
 * @property {() => Promise<any>} json   JSON inválido vira ProviderError `upstream`
 * @property {() => Promise<Uint8Array>} bytes
 */

/**
 * @typedef {object} OperationContext
 * @property {Account} account
 * @property {Model} model
 * @property {ResolvedCompat} compat
 * @property {any} request
 */

/**
 * @typedef {object} OperationModule
 * @property {(args: OperationContext & { apiKey: string }) => { url: string, headers: Record<string, string>, body: Record<string, unknown> | FormData }} buildRequest
 * @property {(res: OneShotResponse, ctx: OperationContext) => Promise<{ result: Record<string, unknown>, usage: Usage, reportedCostUsd?: number|null }>} parseResponse
 */
```

`ApiModule` ganha:

```js
 * @property {Partial<Record<Exclude<import('./vocabulary.js').Operation, 'chat'>, OperationModule>>} [operations]
```

`parseStream` passa a receber `headers` em `ctx`: `{ account, model, compat, headers }`.

`ChatRequest` ganha `@property {import('./timeouts.js').Timeouts} [timeouts]`.

`Compat` ganha:

```js
 * @property {'json'|'verbose_json'} [sttResponseFormat]
 * @property {string|null} [ttsDefaultVoice]
 * @property {string|null} [ttsDefaultFormat]
 * @property {string} [imagePath]
 * @property {string|null} [imageResponseFormat]
 * @property {string|null} [decisionPath]
```

`compat.structuredOutput` ganha os valores `'response_json_schema'` e `'text_format'`.

`Transport`: `audio` aceita `'inline_data'`; `video` aceita `'inline_data'`.

`Cost` ganha `@property {number} [cacheStoragePerMTokHour]`. `Usage` ganha `@property {number} [cacheStorageTokenHours]`.

### Padrões novos em `BASE` (`src/compat.js`)

```js
  sttResponseFormat: 'json',
  ttsDefaultVoice: null,
  ttsDefaultFormat: null,
  imagePath: '/images/generations',
  imageResponseFormat: 'b64_json',
  decisionPath: null,
```

### Uso — `src/usage.js` (novo)

```js
// ok-gateway-providers — uso normalizado das operações de chamada única.

/** @typedef {import('./types.js').Usage} Usage */

/** Número positivo e finito; o resto vira 0. @param {unknown} v */
export const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Uso a partir dos campos conhecidos. Sem nenhum número, `missing`: uso não declarado não é zero.
 * @param {Partial<Usage>} [partial] @returns {Usage}
 */
export function makeUsage(partial = {}) {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, ...partial };
  const declared = usage.input || usage.output || usage.cacheRead || usage.cacheWrite || usage.cacheWrite1h || usage.audioSeconds;
  return declared ? usage : { ...usage, missing: true };
}

/** Custo informado pelo provedor, ou null. @param {unknown} v */
export const reportedCost = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
```

### Cliente — `src/client.js`

`createClient` devolve, além de `chat`:

```js
    /** @param {{ texts: string[], dimensions?: number, params?: Record<string, unknown>, signal?: AbortSignal, timeouts?: import('./timeouts.js').Timeouts }} request */
    embed(request) { return runOperation('embeddings', { account, model, request, doFetch }); },
    transcribe(request) { return runOperation('transcription', { account, model, request, doFetch }); },
    speak(request) { return runOperation('speech', { account, model, request, doFetch }); },
    generateImage(request) { return runOperation('image-generation', { account, model, request, doFetch }); },
    decide(request) { return runOperation('decision', { account, model, request, doFetch }); },
```

Toda operação resolve em `{ ...result, usage, cost }`, ou rejeita com `ProviderError` com `emitted: false`.

---

## Fase 1 — Infraestrutura

### Task 1.1: tipos, compat, uso e custo

**Files:** Modify `src/types.js`, `src/compat.js`, `src/cost.js`, `src/index.js`. Create `src/usage.js`, `test/usage.test.js`. Test `test/cost.test.js`, `test/compat.test.js`.

- [ ] **Step 1: Criar a branch** (controller, antes do dispatch): `git switch -c feature/t1.2`.
- [ ] **Step 2: Testes que falham.** Em `test/usage.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUsage, reportedCost } from '../src/usage.js';

test('uso com número não é missing', () => {
  assert.equal(makeUsage({ input: 3 }).missing, undefined);
  assert.equal(makeUsage({ audioSeconds: 2 }).missing, undefined);
});
test('uso sem número é missing, nunca zero calado', () => {
  assert.equal(makeUsage().missing, true);
});
test('custo informado inválido vira null', () => {
  assert.equal(reportedCost(0.5), 0.5);
  assert.equal(reportedCost(0), 0);
  for (const v of [-1, NaN, '1', undefined]) assert.equal(reportedCost(v), null);
});
```

Em `test/cost.test.js`, acrescente:

```js
test('armazenamento de cache soma fora das faixas, só na tabela', () => {
  const cost = { input: 1, output: 1, cacheStoragePerMTokHour: 2, tiers: [{ aboveInputTokens: 0, input: 10, output: 10 }] };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, cacheStorageTokenHours: 1_000_000 };
  assert.deepEqual(computeCost({ cost }, usage), { usd: 2, source: 'table' });
  assert.deepEqual(computeCost({ cost }, usage, 0.5), { usd: 0.5, source: 'provider' });
});
```

Em `test/compat.test.js`, acrescente:

```js
test('padrões das operações na base', () => {
  const c = resolveCompat({ api: 'openai-completions' });
  assert.equal(c.sttResponseFormat, 'json');
  assert.equal(c.ttsDefaultVoice, null);
  assert.equal(c.imagePath, '/images/generations');
  assert.equal(c.imageResponseFormat, 'b64_json');
  assert.equal(c.decisionPath, null);
});
```

- [ ] **Step 3: Confirmar a falha:** `node --test --test-force-exit test/usage.test.js test/cost.test.js test/compat.test.js`.
- [ ] **Step 4: Implementar.** Tipos e `BASE` como em "Contratos". `src/usage.js` como em "Contratos". Em `computeCost`, depois do bloco de áudio:

```js
  const storage = n(usage?.cacheStorageTokenHours);
  if (storage && n(cost.cacheStoragePerMTokHour)) {
    usd += (storage * /** @type {number} */ (cost.cacheStoragePerMTokHour)) / PER_MILLION;
  }
```

Em `src/index.js`: `export { makeUsage, reportedCost } from './usage.js';`.

- [ ] **Step 5: Confirmar o verde** com o mesmo comando e `npx tsc --noEmit -p tsconfig.json`.

Mensagem de commit: `feat(tipos): contratos das operações, uso e armazenamento de cache`.

### Task 1.2: cliente com chamada única

**Files:** Modify `src/client.js`. Create `test/operations.test.js`.

- [ ] **Step 1: Testes que falham.** Em `test/operations.test.js`, registre um fio falso `fake-ops` com `registerApi`, cujo módulo `embeddings` devolve `{ result: { vectors: [[1]] }, usage: makeUsage({ input: 2 }), reportedCostUsd: null }`. Casos, com `fetch` falso:

| Caso | Espera |
|---|---|
| Sucesso, modelo com `cost: { input: 1, output: 1 }` | `{ vectors: [[1]], usage, cost: { usd: 0.000002, source: 'table' } }` |
| Modelo sem `embeddings` em `operations` | `unsupported`, `fetch` não é chamado |
| Fio sem `operations.embeddings` | `unsupported`, `fetch` não é chamado |
| `buildRequest` devolve `FormData` | `fetch` recebe o mesmo `FormData` em `body`, e os headers não têm `content-type` |
| Status 429 | `rate_limit`, `emitted: false` |
| `res.json()` com corpo inválido | `upstream` |
| `apiKey` como função que lança | `auth` |
| `firstByteMs: 20` por pedido, `fetch` que não responde | `timeout` |
| `request.timeouts` vence `account.timeouts` | Com a conta em 10 s e o pedido em 20 ms, estoura em 20 ms |
| `idleMs: 20`, corpo que para no meio | `timeout` |
| `signal` abortado | `aborted`, `retryOther: false` |
| `parseResponse` lança `Error` comum | `upstream`, `retryOther: true` |

Acrescente também um caso de chat: `parseStream` recebe `ctx.headers` com o header da resposta, usando o fio falso de `test/client.test.js` como modelo.

- [ ] **Step 2: Confirmar a falha:** `node --test --test-force-exit test/operations.test.js`.
- [ ] **Step 3: Implementar.** Extraia de `startChat` dois auxiliares, sem mudar o comportamento do chat:

```js
/** Chave da conta. Falha vira `auth`. */
async function resolveKey(account, ctx) {
  try {
    const key = typeof account.apiKey === 'function' ? await account.apiKey() : account.apiKey;
    return key ?? '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError({ type: 'auth', ...ctx, cause: err, message: `${ctx.provider}/${ctx.model}: não foi possível obter a chave da conta — ${msg}` });
  }
}

/** Monta o pedido. Erro não tipado = pedido malformado: outro alvo não resolve. */
function buildOrThrow(fn, args, ctx) {
  try { return fn(args); } catch (err) {
    if (err instanceof ProviderError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, cause: err, message: `${ctx.provider}/${ctx.model}: pedido malformado — ${msg}` });
  }
}

/** FormData segue como está; o fetch gera o Content-Type com o boundary. */
const serializeBody = (body) => (body instanceof FormData ? body : JSON.stringify(body));
```

No chat: `createDeadline({ timeouts: { ...account.timeouts, ...request?.timeouts }, signal: local.signal })`, e `api.parseStream(events, { account, model, compat, headers: res.headers })`.

Acrescente `runOperation`:

```js
async function runOperation(operation, { account, model, request, doFetch }) {
  const ctx = { provider: account.provider, model: model.id };
  const deadline = createDeadline({ timeouts: { ...account.timeouts, ...request?.timeouts }, signal: request?.signal });
  try {
    if (!Array.isArray(model.operations) || !model.operations.includes(operation)) {
      throw unsupported(`${ctx.provider}/${ctx.model}: o modelo não declara a operação ${operation}`, ctx);
    }
    const api = APIS.get(account.api);
    const mod = api?.operations?.[operation];
    if (!mod) throw unsupported(`${ctx.provider}/${ctx.model}: o fio "${account.api}" não implementa ${operation}`, ctx);

    const compat = resolveCompat(account, model);
    const opCtx = { account, model, compat, request: request ?? {} };
    const apiKey = await resolveKey(account, ctx);
    const built = buildOrThrow(mod.buildRequest, { ...opCtx, apiKey }, ctx);
    const headers = mergeHeaders(account.headers, compat.headers, built.headers);

    let res;
    try {
      res = await doFetch(built.url, { method: 'POST', headers, body: serializeBody(built.body), signal: deadline.signal });
    } catch (err) {
      throw fromFailure(err, deadline.reason(), ctx, false);
    }
    if (!res.ok) {
      let text = '';
      try { text = await res.text(); } catch { /* corpo ilegível: fica o status */ }
      throw errorFromStatus(res.status, { ...ctx, body: text });
    }
    deadline.touch(); // chegaram os headers: acaba o primeiro byte, começa a inatividade

    const { result, usage, reportedCostUsd } = await mod.parseResponse(oneShot(res, deadline, ctx), opCtx);
    if (deadline.reason()) throw fromFailure(new Error('corpo encerrado'), deadline.reason(), ctx, false);
    return { ...result, usage, cost: computeCost(model, usage, reportedCostUsd) };
  } catch (err) {
    throw err instanceof ProviderError ? err : fromFailure(err, deadline.reason(), ctx, false);
  } finally {
    deadline.clear();
  }
}

/** Resposta inteira, lendo o corpo com o relógio de inatividade. */
function oneShot(res, deadline, ctx) {
  const bytes = async () => {
    if (!res.body) return new Uint8Array();
    const chunks = [];
    let total = 0;
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      deadline.touch();
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  };
  return {
    status: res.status,
    headers: res.headers,
    bytes,
    async json() {
      const raw = new TextDecoder().decode(await bytes());
      try { return JSON.parse(raw); } catch (err) {
        throw new ProviderError({ type: 'upstream', ...ctx, cause: err, body: raw, message: `${ctx.provider}/${ctx.model}: resposta não é JSON` });
      }
    },
  };
}
```

`createClient` ganha os cinco métodos. Teste antigo que confira as chaves de `createClient` deve aceitar os novos.

- [ ] **Step 4: Confirmar o verde:** `node --test --test-force-exit test/operations.test.js test/client.test.js test/openai-completions.test.js test/anthropic-messages.test.js`, e `npx tsc --noEmit -p tsconfig.json`.

Mensagem de commit: `feat(cliente): operações de chamada única, FormData e prazos por pedido`.

**Pergunta de julgamento:** algum caminho de `runOperation` deixa o relógio armado, ou devolve erro sem tipo?

### Task 1.3: transporte `inline_data`

**Files:** Modify `src/attachments.js`. Test `test/attachments.test.js`.

- [ ] **Step 1: Testes que falham:**

```js
test('inline_data aceita áudio e vídeo em base64', () => {
  const model = { id: 'm', input: ['audio', 'video'], transport: { audio: 'inline_data', video: 'inline_data' } };
  assertMediaSupported({ type: 'audio', data: 'QQ==', format: 'mp3' }, model);
  assertMediaSupported({ type: 'video', data: 'QQ==', mime: 'video/mp4' }, model);
});
test('inline_data recusa vídeo por URL e vídeo sem mime', () => {
  const model = { id: 'm', input: ['video'], transport: { video: 'inline_data' } };
  assert.throws(() => assertMediaSupported({ type: 'video', url: 'https://x/v.mp4' }, model), (e) => e.type === 'unsupported');
  assert.throws(() => assertMediaSupported({ type: 'video', data: 'QQ==' }, model), (e) => e.type === 'invalid_request');
});
```

- [ ] **Step 2: Implementar.** Em `assertMediaSupported`:
  - áudio: `if (t !== 'input_audio' && t !== 'inline_data') throw fail(...)`;
  - vídeo: aceite `'inline_data'` na checagem do transporte;
  - trate `inline_data` junto com `input_video`: `if (t === 'input_video' || t === 'inline_data') { ...exige data e mime }`.
- [ ] **Step 3: Confirmar o verde:** `node --test --test-force-exit test/attachments.test.js`.

Mensagem de commit: `feat(anexos): transporte inline_data para áudio e vídeo`.

### Task 1.4: gravador de fixtures

**Files:** Modify `scripts/record-fixture.mjs`, `.gitattributes`. Create `test/record-fixture.test.js`. Mova `scrub` e `describeBody` para `scripts/record-fixture-lib.mjs`, para o teste importar sem executar o script.

- [ ] **Step 1: Testes que falham**, em `test/record-fixture.test.js`:

| Função | Caso | Espera |
|---|---|---|
| `scrub(text, key)` | contém a chave, `sk-abc…`, `AIzaSy…`, `Bearer xyz…` | os quatro viram `<REDACTED>` |
| `describeBody(formData)` | campo `model` e arquivo de 5 bytes | `{ model: 'x', file: { name: 'a.mp3', type: 'audio/mpeg', bytes: 5 } }` |
| `describeBody(obj)` | objeto comum | o próprio objeto |
| `selectHeaders(headers)` | `content-type`, `x-generation-id`, `authorization`, `set-cookie` | só os dois primeiros |

- [ ] **Step 2: Implementar a biblioteca.**

```js
// scripts/record-fixture-lib.mjs
const KEEP = new Set(['content-type', 'x-generation-id']);

export const scrub = (s, key) => (key ? s.split(key).join('<REDACTED>') : s)
  .replace(/sk-[A-Za-z0-9_-]{10,}/g, '<REDACTED>')
  .replace(/AIza[A-Za-z0-9_-]{10,}/g, '<REDACTED>')
  .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/g, 'Bearer <REDACTED>');

export function selectHeaders(headers) {
  const out = {};
  for (const [k, v] of headers) if (KEEP.has(k.toLowerCase())) out[k.toLowerCase()] = v;
  return out;
}

export function describeBody(body) {
  if (!(body instanceof FormData)) return body;
  const out = {};
  for (const [k, v] of body) out[k] = typeof v === 'string' ? v : { name: v.name, type: v.type, bytes: v.size };
  return out;
}
```

- [ ] **Step 3: Implementar o script.** Novos argumentos: `--operation` (padrão `chat`), `--binary` e `--provider`. Em operação, `api.operations[op].buildRequest` monta o pedido. `transcribe` lê o áudio de `request.audioFile` e monta `audio` e `mime`. Grava:
  - `<out>`: corpo. Texto passa por `scrub`; com `--binary`, bytes crus;
  - `<out>.meta.json`: `{ status, headers: selectHeaders(res.headers) }`;
  - `<out>.request.json`: `scrub(JSON.stringify(describeBody(built.body), null, 2))`.
  - O modelo usa `operations: [op]`.

Em `.gitattributes`, acrescente a linha `test/fixtures/**/*.bin binary`. Ela vem depois da regra de texto, e a última vence.

- [ ] **Step 4: Confirmar o verde:** `node --test --test-force-exit test/record-fixture.test.js`.

Mensagem de commit: `feat(fixtures): gravador com operação, binário e headers selecionados`.

### Fim da Fase 1

- [ ] `npm test` e `npx tsc --noEmit -p tsconfig.json`. Nada do chat pode ter mudado.
- [ ] Revisão de fase pelo `reviewer-gemini`, com a spec, este plano e `git diff main...HEAD`. Pergunte especificamente: o comportamento do `chat` mudou? `emitted` pode sair `true` em chamada única? Algum corpo é lido duas vezes?

---

## Fase 2 — Operações em `openai-completions`

As Tasks 2.1 a 2.4 mexem em arquivos separados e rodam em paralelo. **Só o controller edita** `src/apis/openai-completions.js`, depois de todas, para ligar os módulos.

Testes com `fetch` falso: `const f = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(corpo), { status: 200 }); };`.

Conta de teste: `{ id: 'a', provider: 'p', api: 'openai-completions', baseUrl: 'https://x/v1', apiKey: 'k' }`.

### Task 2.1: embeddings

**Files:** Create `src/apis/openai-completions/embeddings.js`, `test/op-embeddings.test.js`.

```js
// ok-gateway-providers — embeddings no formato OpenAI.
import { ProviderError } from '../../errors.js';
import { makeUsage, num, reportedCost } from '../../usage.js';

const PROTECTED = new Set(['model', 'input']);

/** @type {import('../../types.js').OperationModule} */
export const embeddings = {
  buildRequest({ account, model, request, apiKey }) {
    if (!Array.isArray(request.texts) || request.texts.length === 0 || request.texts.some((t) => typeof t !== 'string')) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, provider: account.provider, model: model.id, message: `${account.provider}/${model.id}: texts precisa ser uma lista de textos` });
    }
    const body = { model: model.id, input: request.texts };
    if (request.dimensions !== undefined) body.dimensions = request.dimensions;
    for (const layer of [model.params, request.params]) {
      for (const [k, v] of Object.entries(layer ?? {})) if (!PROTECTED.has(k)) body[k] = v;
    }
    return {
      url: `${account.baseUrl.replace(/\/+$/, '')}/embeddings`,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body,
    };
  },
  async parseResponse(res, { account, model, request }) {
    const json = await res.json();
    const items = Array.isArray(json?.data) ? [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
    if (items.length !== request.texts.length || items.some((i) => !Array.isArray(i.embedding))) {
      throw new ProviderError({ type: 'upstream', provider: account.provider, model: model.id, body: json, message: `${account.provider}/${model.id}: resposta com ${items.length} vetor(es) para ${request.texts.length} texto(s)` });
    }
    const u = json.usage ?? {};
    const cached = num(u.prompt_tokens_details?.cached_tokens);
    const usage = makeUsage({ input: Math.max(0, num(u.prompt_tokens) - cached), cacheRead: cached, raw: json.usage });
    return { result: { vectors: items.map((i) => i.embedding) }, usage, reportedCostUsd: reportedCost(u.cost) };
  },
};
```

**Testes** (`test/op-embeddings.test.js`, chamando `embeddings.buildRequest` e `embeddings.parseResponse` direto):

| Caso | Espera |
|---|---|
| Pedido com `dimensions: 768` | corpo com `dimensions: 768`; sem ela, o campo não existe |
| `params: { model: 'z', foo: 1 }` | `model` continua o do modelo; `foo` passa |
| `texts: []` | `invalid_request`, `retryOther: false` |
| `data` fora de ordem | vetores em ordem de `index` |
| 1 vetor para 2 textos | `upstream` |
| `prompt_tokens: 10`, `cached_tokens: 4` | `input: 6`, `cacheRead: 4` |
| Sem `usage` | `usage.missing === true` |
| `usage.cost: 0.01` | `reportedCostUsd: 0.01` |

Mensagem de commit: `feat(embeddings): operação no fio openai-completions`.

### Task 2.2: transcrição

**Files:** Create `src/apis/openai-completions/transcription.js`, `test/op-transcription.test.js`.

```js
// ok-gateway-providers — transcrição no formato OpenAI (OpenAI, Groq).
import { ProviderError } from '../../errors.js';
import { mediaFormat } from '../../attachments.js';
import { makeUsage, num, reportedCost } from '../../usage.js';

const PROTECTED = new Set(['model', 'file', 'response_format', 'language', 'prompt']);

/** @param {any} json */
function durationOf(json) {
  if (typeof json?.duration === 'number' && Number.isFinite(json.duration)) return json.duration;
  const ends = Array.isArray(json?.segments) ? json.segments.map((s) => s?.end).filter((e) => typeof e === 'number') : [];
  return ends.length ? Math.max(...ends) : undefined;
}

/** @type {import('../../types.js').OperationModule} */
export const transcription = {
  buildRequest({ account, model, compat, request, apiKey }) {
    const ctx = { provider: account.provider, model: model.id };
    if (!(request.audio instanceof Uint8Array) || request.audio.length === 0) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, message: `${ctx.provider}/${ctx.model}: audio precisa ser Uint8Array não vazio` });
    }
    if (!request.mime) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, message: `${ctx.provider}/${ctx.model}: audio precisa de mime` });
    }
    const form = new FormData();
    form.append('file', new Blob([request.audio], { type: request.mime }), request.filename ?? `audio.${mediaFormat(request.mime)}`);
    form.append('model', model.id);
    form.append('response_format', compat.sttResponseFormat);
    if (request.language) form.append('language', request.language);
    if (request.prompt) form.append('prompt', request.prompt);
    for (const layer of [model.params, request.params]) {
      for (const [k, v] of Object.entries(layer ?? {})) if (!PROTECTED.has(k) && v !== undefined) form.append(k, String(v));
    }
    return {
      url: `${account.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body: form,
    };
  },
  async parseResponse(res, { account, model }) {
    const json = await res.json();
    if (typeof json?.text !== 'string') {
      throw new ProviderError({ type: 'upstream', provider: account.provider, model: model.id, body: json, message: `${account.provider}/${model.id}: transcrição sem text` });
    }
    const durationSeconds = durationOf(json);
    const u = json.usage ?? {};
    const usage = makeUsage({
      input: num(u.input_tokens), output: num(u.output_tokens),
      ...(durationSeconds !== undefined ? { audioSeconds: durationSeconds } : {}),
      raw: json.usage ?? json.x_groq,
    });
    return {
      result: { text: json.text, ...(durationSeconds !== undefined ? { durationSeconds } : {}) },
      usage,
      reportedCostUsd: reportedCost(u.cost),
    };
  },
};
```

**Testes:**

| Caso | Espera |
|---|---|
| `mime: 'audio/mpeg'`, sem `filename` | arquivo `audio.mp3`, com o tipo certo no `FormData` |
| `compat.sttResponseFormat: 'verbose_json'` | campo `response_format` igual |
| `language` e `prompt` ausentes | campos ausentes |
| `audio` vazio ou sem `mime` | `invalid_request`, `retryOther: false` |
| Sem chave | sem header `Authorization` |
| `{ text, duration: 12.5 }` | `durationSeconds: 12.5`, `usage.audioSeconds: 12.5` |
| `{ text, segments: [{ end: 3 }, { end: 7 }] }` | `durationSeconds: 7` |
| `{ text, usage: { input_tokens: 5, output_tokens: 2 } }` | `input: 5`, `output: 2` |
| `{ text }` sem mais nada | `usage.missing === true` |
| Sem `text` | `upstream` |

Mensagem de commit: `feat(transcrição): operação no fio openai-completions`.

### Task 2.3: fala

**Files:** Create `src/apis/openai-completions/speech.js`, `test/op-speech.test.js`.

```js
// ok-gateway-providers — fala no formato OpenAI. `usage.input` = caracteres; `cost.input` = US$ por milhão de caracteres.
import { ProviderError } from '../../errors.js';
import { makeUsage } from '../../usage.js';

const PROTECTED = new Set(['model', 'input', 'voice', 'response_format']);

/** @type {Record<string, string>} */
const CONTENT_TYPE = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/opus', aac: 'audio/aac', flac: 'audio/flac', pcm: 'audio/pcm' };

/** @type {import('../../types.js').OperationModule} */
export const speech = {
  buildRequest({ account, model, compat, request, apiKey }) {
    if (typeof request.text !== 'string' || !request.text) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, provider: account.provider, model: model.id, message: `${account.provider}/${model.id}: text é obrigatório` });
    }
    const body = {};
    for (const layer of [model.params, request.params]) {
      for (const [k, v] of Object.entries(layer ?? {})) if (!PROTECTED.has(k) && v !== undefined) body[k] = v;
    }
    body.model = model.id;
    body.input = request.text;
    const voice = request.voice ?? compat.ttsDefaultVoice;
    const format = request.format ?? compat.ttsDefaultFormat;
    if (voice) body.voice = voice;
    if (format) body.response_format = format;
    if (request.instructions) body.instructions = request.instructions;
    if (request.speed !== undefined) body.speed = request.speed;
    return {
      url: `${account.baseUrl.replace(/\/+$/, '')}/audio/speech`,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body,
    };
  },
  async parseResponse(res, { account, model, compat, request }) {
    const audio = await res.bytes();
    if (audio.length === 0) {
      throw new ProviderError({ type: 'upstream', provider: account.provider, model: model.id, message: `${account.provider}/${model.id}: resposta de fala vazia` });
    }
    const header = res.headers.get('content-type');
    const format = request.format ?? compat.ttsDefaultFormat;
    const contentType = header?.toLowerCase().startsWith('audio/') ? header : (CONTENT_TYPE[format] ?? 'application/octet-stream');
    const generationId = res.headers.get('x-generation-id');
    const usage = makeUsage({ input: request.text.length, ...(generationId ? { raw: { generationId } } : {}) });
    return { result: { audio, contentType }, usage, reportedCostUsd: null };
  },
};
```

**Testes:**

| Caso | Espera |
|---|---|
| Sem voz nem formato, compat nulo | corpo só com `model` e `input` |
| `compat.ttsDefaultVoice: 'onyx'`, `ttsDefaultFormat: 'mp3'` | os dois no corpo; `voice` do pedido vence |
| `params: { input: 'x', sample_rate: 24000 }` | `input` protegido; `sample_rate` passa |
| `instructions` e `speed` | só vão quando vierem |
| Header `audio/pcm;rate=24000` | `contentType` igual, com o parâmetro |
| Header `application/octet-stream`, formato `mp3` | `audio/mpeg` |
| Corpo vazio | `upstream` |
| `text: 'abc'` | `usage.input: 3` |
| Header `x-generation-id: g1` | `usage.raw.generationId: 'g1'` |

Mensagem de commit: `feat(fala): operação no fio openai-completions`.

### Task 2.4: imagem e decisão

**Files:** Create `src/apis/openai-completions/image.js`, `src/apis/openai-completions/decision.js`, `test/op-image.test.js`, `test/op-decision.test.js`.

```js
// src/apis/openai-completions/image.js
import { ProviderError } from '../../errors.js';
import { makeUsage, num, reportedCost } from '../../usage.js';

const PROTECTED = new Set(['model', 'prompt', 'response_format']);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** @type {import('../../types.js').OperationModule} */
export const imageGeneration = {
  buildRequest({ account, model, compat, request, apiKey }) {
    if (typeof request.prompt !== 'string' || !request.prompt) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, provider: account.provider, model: model.id, message: `${account.provider}/${model.id}: prompt é obrigatório` });
    }
    const body = {};
    for (const layer of [model.params, request.params]) {
      for (const [k, v] of Object.entries(layer ?? {})) if (!PROTECTED.has(k) && v !== undefined) body[k] = v;
    }
    body.model = model.id;
    body.prompt = request.prompt;
    if (compat.imageResponseFormat) body.response_format = compat.imageResponseFormat;
    return {
      url: `${account.baseUrl.replace(/\/+$/, '')}${compat.imagePath}`,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body,
    };
  },
  async parseResponse(res, { account, model, request }) {
    const json = await res.json();
    const fail = (message) => new ProviderError({ type: 'upstream', provider: account.provider, model: model.id, body: json, message: `${account.provider}/${model.id}: ${message}` });
    const data = Array.isArray(json?.data) ? json.data : [];
    if (data.length === 0) throw fail('resposta de imagem sem data');
    const n = request.params?.n ?? model.params?.n;
    if (typeof n === 'number' && data.length !== n) throw fail(`pedidas ${n} imagens, vieram ${data.length}`);
    const images = data.map((item) => {
      const b64 = item?.b64_json;
      if (typeof b64 !== 'string' || b64.length % 4 !== 0 || !BASE64.test(b64)) throw fail('imagem com base64 inválido');
      return { base64: b64, mediaType: item.media_type ?? 'image/png' };
    });
    const u = json.usage ?? {};
    const usage = makeUsage({ input: num(u.prompt_tokens), output: num(u.completion_tokens), raw: json.usage });
    return { result: { images }, usage, reportedCostUsd: reportedCost(u.cost) };
  },
};
```

```js
// src/apis/openai-completions/decision.js
import { ProviderError, unsupported } from '../../errors.js';
import { makeUsage, num, reportedCost } from '../../usage.js';

const PROTECTED = new Set(['model', 'state', 'questions']);
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** @type {import('../../types.js').OperationModule} */
export const decision = {
  buildRequest({ account, model, compat, request, apiKey }) {
    const ctx = { provider: account.provider, model: model.id };
    if (!compat.decisionPath) throw unsupported(`${ctx.provider}/${ctx.model}: a conta não declara compat.decisionPath`, ctx);
    if (!isObject(request.state) || !isObject(request.questions) || Object.keys(request.questions).length === 0) {
      throw new ProviderError({ type: 'invalid_request', retryOther: false, ...ctx, message: `${ctx.provider}/${ctx.model}: state e questions precisam ser objetos, e questions não pode ser vazio` });
    }
    const body = {};
    for (const layer of [model.params, request.params]) {
      for (const [k, v] of Object.entries(layer ?? {})) if (!PROTECTED.has(k) && v !== undefined) body[k] = v;
    }
    body.model = model.id;
    body.state = request.state;
    body.questions = request.questions;
    return {
      // Resolvido contra a base: `../alpha/decisions` sai de /api/v1 para /api/alpha/decisions.
      url: new URL(compat.decisionPath, `${account.baseUrl.replace(/\/+$/, '')}/`).href,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body,
    };
  },
  async parseResponse(res, { account, model }) {
    const json = await res.json();
    if (!isObject(json?.answers) || Object.keys(json.answers).length === 0) {
      throw new ProviderError({ type: 'upstream', provider: account.provider, model: model.id, body: json, message: `${account.provider}/${model.id}: decisão sem answers` });
    }
    const u = json.usage ?? {};
    const usage = makeUsage({ input: num(u.input_tokens), output: num(u.output_tokens), raw: json.usage });
    return { result: { answers: json.answers }, usage, reportedCostUsd: reportedCost(u.cost) };
  },
};
```

**Testes de imagem:**

| Caso | Espera |
|---|---|
| Padrão | URL `…/images/generations`, corpo com `response_format: 'b64_json'` |
| `compat: { imagePath: '/images', imageResponseFormat: null }` | URL `…/images`, sem `response_format` |
| `{ data: [{ b64_json: 'QUJD', media_type: 'image/webp' }], usage: { prompt_tokens: 1, completion_tokens: 2, cost: 0.1 } }` | imagem certa, `reportedCostUsd: 0.1` |
| Sem `media_type` | `image/png` |
| `data: []`, `params.n: 2` com 1 imagem, base64 `'a b'` | `upstream` |
| Sem `usage.cost` | `reportedCostUsd: null`, sem erro (T5) |

**Testes de decisão:**

| Caso | Espera |
|---|---|
| Base `https://openrouter.ai/api/v1`, `decisionPath: '../alpha/decisions'` | URL `https://openrouter.ai/api/alpha/decisions` |
| Base `https://api.typesafe.ai/v1`, `decisionPath: 'systemone'` | URL `https://api.typesafe.ai/v1/systemone` |
| Sem `decisionPath` | `unsupported` |
| `questions: {}`, `state: []` | `invalid_request`, `retryOther: false` |
| `{ answers: { a: 1 }, usage: { input_tokens: 3, output_tokens: 4, cost: 0.2 } }` | `answers`, `input: 3`, `output: 4`, `reportedCostUsd: 0.2` |
| `answers: {}` | `upstream` |
| Sem `cost` (TypeSafe) | `reportedCostUsd: null`, sem erro |

Mensagem de commit: `feat(imagem,decisão): operações no fio openai-completions`.

### Task 2.5: catálogo

**Files:** Modify `src/catalog/openrouter.js`. Test `test/catalog.test.js`.

- [ ] **Step 1: Testes que falham:**

| `output_modalities` | Espera em `operations` |
|---|---|
| `['embeddings']` | `['embeddings']` |
| `['image']` | `['image-generation']` |
| `['audio']` | `['speech']` |
| `['text', 'image']` | `['chat']` |
| `['text']` | `['chat']` |

- [ ] **Step 2: Implementar.** Substitua o cálculo de `operations` e o comentário acima dele:

```js
  // Saída só de imagem ou só de áudio vai pelas rotas próprias (/images, /audio/speech).
  // Saída mista segue no chat.
  /** @type {Model['operations']} */
  const operations = outputList.includes('embeddings') ? ['embeddings']
    : outputList.length === 1 && outputList[0] === 'image' ? ['image-generation']
    : outputList.length === 1 && outputList[0] === 'audio' ? ['speech']
    : ['chat'];
```

Se um teste existente esperava `chat` para saída só de imagem, atualize esse teste e relate.

Mensagem de commit: `feat(catálogo): operação de imagem e de fala pela modalidade de saída`.

### Ligar os módulos (controller)

- [ ] Em `src/apis/openai-completions.js`:

```js
import { embeddings } from './openai-completions/embeddings.js';
import { transcription } from './openai-completions/transcription.js';
import { speech } from './openai-completions/speech.js';
import { imageGeneration } from './openai-completions/image.js';
import { decision } from './openai-completions/decision.js';

export const operations = { embeddings, transcription, speech, 'image-generation': imageGeneration, decision };
```

- [ ] `test/op-integration.test.js`: chama `createClient(...).embed`, `.transcribe`, `.speak`, `.generateImage` e `.decide` pela porta pública, com `fetch` falso, e confere `usage` e `cost`.
- [ ] `npm test` e `npx tsc --noEmit -p tsconfig.json`.

### Task 2.6: gravar fixtures reais (controller)

Chaves vêm de `node --env-file=/e/Projetos/igris-gateway/.env`. Custo estimado: menos de US$ 0,05.

| Fixture em `test/fixtures/operations/` | Provedor e modelo |
|---|---|
| `embeddings-openai.json` | OpenAI `text-embedding-3-small` |
| `stt-groq.json` | Groq `whisper-large-v3-turbo`, com o áudio de `tts-openai.bin` |
| `stt-openai.json` | OpenAI `gpt-4o-transcribe` |
| `tts-openai.bin` | OpenAI `tts-1`, `format: 'mp3'`, texto curto (abaixo de 20 KB) |
| `tts-openrouter.bin` | OpenRouter `google/gemini-3.1-flash-tts-preview`, texto curto |
| `image-openrouter.json` | OpenRouter `qwen/qwen-image-3`, com `b64_json` trocado por um PNG 1×1 depois de gravar, porque a imagem real pesa |
| `decision-openrouter.json` | OpenRouter `typesafe/jev-1.13` |
| `decision-typesafe.json` | TypeSafe, modelo `jev-1.13` |

- [ ] Gravar com `scripts/record-fixture.mjs`.
- [ ] Conferir: `grep -rlE "sk-|AIza|Bearer " test/fixtures/operations` não acha nada.
- [ ] `test/op-fixtures.test.js`: passa cada fixture por `parseResponse` e confere a forma do resultado e o uso. Fixture binária usa o `.meta.json` para os headers.

Mensagem de commit: `test(operações): fixtures gravadas de provedores reais`.

### Fim da Fase 2

- [ ] `npm test` e `npx tsc --noEmit -p tsconfig.json`.
- [ ] Revisão de fase pelo `reviewer-gemini`. Pergunte especificamente: comparando com `E:\Projetos\igris-gateway\.worktrees\t2.1-perfis-produtos-api\src\providers\{openai,openrouter,groq,typesafe}.ts`, algum campo enviado ou lido se perdeu? Alguma validação do adapter sumiu sem motivo declarado na spec?

---

## Fase 3 — Fio `google-generative-ai`

### Task 3.1: pedido

**Files:** Create `src/apis/google-generative-ai.js`, `test/google-generative-ai.test.js`. Modify `src/compat.js` (padrão do fio), `src/index.js` (registra e exporta `toGeminiContents`), `test/index.test.js` (lista de fios), `src/apis/openai-completions.js` e `src/apis/anthropic-messages.js` (recusam `cachedContent` com `unsupported`).

Padrão em `DEFAULT_COMPAT`:

```js
  'google-generative-ai': Object.freeze({ ...BASE, structuredOutput: 'response_json_schema', usageInStream: true }),
```

Referência de leitura: `E:\Projetos\igris-gateway\.worktrees\t2.1-perfis-produtos-api\src\providers\google.ts`. Reescreva; não porte linha a linha.

**`buildRequest`:**

| Campo | Regra |
|---|---|
| URL | `${base}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse` |
| Headers | `content-type: application/json`, `x-goog-api-key: <chave>`, `accept: text/event-stream` |
| `contents` | `toGeminiContents(messages, { model, provider })` |
| `systemInstruction` | `{ parts: [{ text }] }`, juntando os blocos sem separador |
| `tools` | `[{ functionDeclarations: [{ name, description?, parameters }] }]` |
| `generationConfig.temperature` | `request.temperature`, se `compat.supportsTemperature` |
| `generationConfig.maxOutputTokens` | `request.maxTokens` |
| `generationConfig.responseMimeType` + `responseJsonSchema` | com `responseSchema` e `structuredOutput: 'response_json_schema'`; outro valor dá `unsupported` |
| `cachedContent` | `request.cachedContent`. Com `system` ou `tools` junto dá `invalid_request`, `retryOther: false` |
| `params` | modelo, depois pedido. Protegidos: `contents`, `systemInstruction`, `tools`, `cachedContent` |

`generationConfig` só vai se tiver campo. `ChatRequest` ganha `@property {string} [cachedContent]`; os outros fios dão `unsupported` quando ele vier.

**`toGeminiContents(messages, ctx)`** (exportada):

| Mensagem | Vira |
|---|---|
| `user`, string | `{ role: 'user', parts: [{ text }] }` |
| `user`, parte `text` | `{ text }` |
| `user`, parte `image`, `audio`, `video`, `file` com `data` | `{ inlineData: { mimeType, data } }`, sem o prefixo `data:…;base64,`. Áudio usa `audio/${format}` |
| `user`, parte de mídia com `url` | `unsupported` |
| `assistant` | `{ role: 'model', parts: [{ text? }, { functionCall: { name, args } }…] }`. `args` = `JSON.parse(arguments)`; JSON inválido dá `invalid_request` |
| `tool` | `{ role: 'function', parts: [{ functionResponse: { name, response: { content } } }] }`, com `name` achado pelo `toolCallId` nas mensagens anteriores. Sem chamada correspondente: `invalid_request` |
| Conteúdo vazio | `parts: [{ text: '' }]` |

Valide cada mídia com `assertMediaSupported(part, modelComPadrao, ctx)`, sendo `modelComPadrao = { ...model, transport: { image: ['data-url'], audio: 'inline_data', video: 'inline_data', file: ['data-url'], ...model.transport } }`.

**Testes:** um para cada linha das duas tabelas, mais `cachedContent` sem `system` e sem `tools`, conferindo que `generationConfig` continua indo.

Mensagem de commit: `feat(google): pedido do fio google-generative-ai`.

**Pergunta de julgamento:** existe algum formato de `inlineData` que o Gemini recuse e o teste não veja? Liste o que só a fixture real prova.

### Task 3.2: stream

**Files:** Modify `src/apis/google-generative-ai.js`. Create `test/fixtures/google-generative-ai/*.sse` à mão, no formato real. Test `test/google-generative-ai.test.js`.

**`parseStream`:**

| Entrada | Saída |
|---|---|
| `part.text` | evento `text` |
| `part.text` com `part.thought === true` | evento `reasoning` |
| `part.functionCall` | evento `tool_call`, com `id: 'gemini-tc-{n}'` (`n` começa em 0), `arguments: JSON.stringify(args)` |
| `finishReason: 'STOP'` | `stop`; com tool call na resposta, `tool_calls` |
| `finishReason: 'MAX_TOKENS'` | `length` |
| `finishReason: 'SAFETY'`, `'RECITATION'` | `content_filter` |
| Outro `finishReason` | passa em minúsculas |
| Objeto `error` no chunk | `errorFromStatus(error.code, { message: error.message, emitted })` |
| `promptFeedback.blockReason`, sem candidatos | `finishReason: 'content_filter'` |
| Stream termina sem `finishReason` | `ProviderError` `upstream`, como no fio `openai-completions` |
| Chunk que não é JSON | `upstream` (hoje é ignorado) |

**Uso**, do último `usageMetadata`: `input = promptTokenCount − cachedContentTokenCount`, `output = candidatesTokenCount + thoughtsTokenCount`, `cacheRead = cachedContentTokenCount`, `reasoning = thoughtsTokenCount`, `raw`. Sem `usageMetadata`: `makeUsage()`, que marca `missing`.

**Testes:** um por linha, com fixture à mão em `test/fixtures/google-generative-ai/`: `text.sse`, `thought.sse`, `tool-call.sse`, `max-tokens.sse`, `safety.sse`, `error-mid.sse`, `cached.sse`.

Mensagem de commit: `feat(google): stream, uso e erros do fio google-generative-ai`.

### Task 3.3: fixtures reais (controller)

Modelo: `gemini-3.5-flash`. Custo estimado: menos de US$ 0,02. Grave por cima das fixtures à mão de `text.sse`, `thought.sse` e `tool-call.sse`, e grave `image.sse` com imagem. Rode `node --test --test-force-exit test/google-generative-ai.test.js`. Divergência entre a fixture real e o fio é correção no fio.

### Fim da Fase 3

- [ ] `npm test` e `npx tsc --noEmit -p tsconfig.json`.
- [ ] Revisão de fase pelo `reviewer-deepseek`. Pergunte especificamente: comparando com `google.ts` e `google-cache.ts` do Gateway, o `google-cache.ts` consegue usar `toGeminiContents` da lib sem nenhuma adaptação? Algo foi descartado em silêncio? O que o adapter faz e o fio não faz, além do reenvio sem cache?

---

## Fase 4 — Contrato de chat

### Task 4.1: `toolChoice`, `stop`, `reasoning` e `isError`

**Files:** Modify `src/types.js`, `src/apis/openai-completions.js`, `src/apis/anthropic-messages.js`, `src/apis/google-generative-ai.js`. Tests `test/openai-completions.compat.test.js`, `test/anthropic-messages.compat.test.js`, `test/google-generative-ai.test.js`.

Tipos: `ChatRequest` ganha `toolChoice?: 'auto'|'none'|'required'|{ name: string }`, `stop?: string[]`, `reasoning?: { maxTokens?: number, exclude?: boolean }`. `Message` ganha `isError?: boolean`.

| Campo | `openai-completions` | `anthropic-messages` | `google-generative-ai` |
|---|---|---|---|
| `toolChoice: 'auto'` | `tool_choice: 'auto'` | `tool_choice: { type: 'auto' }` | `toolConfig.functionCallingConfig.mode: 'AUTO'` |
| `'none'` | `'none'` | `{ type: 'none' }` | `mode: 'NONE'` |
| `'required'` | `'required'` | `{ type: 'any' }` | `mode: 'ANY'` |
| `{ name }` | `{ type: 'function', function: { name } }` | `{ type: 'tool', name }` | `mode: 'ANY'`, `allowedFunctionNames: [name]` |
| `stop` | `stop` | `stop_sequences` | `generationConfig.stopSequences` |
| `reasoning.maxTokens` e `exclude` | Com `reasoning_object`: `reasoning.max_tokens`, `reasoning.exclude`. Outro formato: `unsupported` | `unsupported` | `unsupported` |
| `isError` no papel `tool` | texto com prefixo `Tool error: ` | `is_error: true` | `functionResponse.response: { error: texto }` |

`toolChoice` sem `tools` dá `invalid_request`, `retryOther: false`, nos três fios.

**Testes:** uma linha da matriz por caso, nos arquivos de compat de cada fio. Inclua: `effort` e `reasoning.maxTokens` juntos no objeto.

Mensagem de commit: `feat(chat): toolChoice, stop, reasoning e isError nos fios`.

### Task 4.2: raciocínio assinado

**Files:** Modify `src/types.js`, `src/apis/anthropic-messages.js`, `src/apis/google-generative-ai.js`, `src/apis/openai-completions.js`. Tests nos arquivos de teste de cada fio.

Tipos:

```js
 *   | { type: 'reasoning', text: string, signature?: string, redacted?: string }   // em Part
```

- `ChatEvent` `reasoning` ganha `signature?` e `redacted?`.
- `ToolCall` e o evento `tool_call` ganham `providerData?: Record<string, unknown>`.

| Fio | Leitura | Devolução (papel `assistant`) |
|---|---|---|
| `anthropic-messages` | `signature_delta` → evento `reasoning` com `text: ''` e `signature`. Bloco `redacted_thinking` → evento com `redacted: data` | Parte `reasoning` vira `{ type: 'thinking', thinking, signature }` ou `{ type: 'redacted_thinking', data }`, **antes** do texto e das tool calls |
| `google-generative-ai` | `part.thoughtSignature` junto de `functionCall` → `providerData: { thoughtSignature }` | `toolCalls[].providerData.thoughtSignature` volta na parte `functionCall` |
| `openai-completions` | — | Parte `reasoning` é **ignorada de propósito**, para o fallback entre modelos funcionar |

Na Anthropic, parte `reasoning` sem `signature` e sem `redacted` é ignorada: a API a recusaria.

**Testes:** leitura e devolução em cada fio, e a parte `reasoning` em `openai-completions` sem erro e fora do corpo.

Mensagem de commit: `feat(chat): ida e volta do raciocínio assinado`.

### Task 4.3: ciclo real de tool com pensamento (controller)

- [ ] Em `scripts/smoke.mjs`, caso `ciclo de tool`: chama com uma tool e pensamento ligado, devolve o resultado com a parte `reasoning` e `providerData` recebidos, e espera a resposta final.
  - Anthropic: `claude-haiku-5-5`, `effort: 'low'`.
  - Google: `gemini-3.5-flash`.
- [ ] Rodar com as chaves. Custo estimado: menos de US$ 0,01.
- [ ] Registrar nas pendências da lib se a assinatura é obrigatória em cada provedor, com a mensagem de erro de quando falta. Para isso, repita o caso sem a devolução.

Mensagem de commit: `test(smoke): ciclo de tool com pensamento`.

### Fim da Fase 4

- [ ] `npm test` e `npx tsc --noEmit -p tsconfig.json`.
- [ ] Revisão de fase pelo `reviewer-gemini`. Pergunte especificamente: `toolChoice` e `stop` chegam a todos os fios? Mandar parte `reasoning` de um provedor para outro quebra algum corpo?

---

## Fase 5 — Fio `openai-responses`

### Task 5.1: pedido e stream

**Files:** Create `src/apis/openai-responses.js`, `test/openai-responses.test.js`, `test/fixtures/openai-responses/*.sse` à mão. Modify `src/compat.js`, `src/index.js`, `test/index.test.js`.

Padrão:

```js
  'openai-responses': Object.freeze({ ...BASE, maxTokensField: 'max_output_tokens' }),
```

Referência de leitura: `E:\Projetos\Igris\packages\providers\src\protocols\openai.js`, `openai-usage.js`.

**`buildRequest`:** URL `${base}/responses`.

| Campo | Regra |
|---|---|
| `input` | Sistema como `{ type: 'message', role: 'system', content }`. Todo item com `type` explícito |
| `user`, partes | `input_text`, `input_image` (`image_url` com data-url ou URL), `input_file` (`filename`, `file_data` com data-url). Áudio e vídeo: `unsupported` |
| `assistant` | `{ type: 'message', role: 'assistant', content: texto }`, seguido de `{ type: 'function_call', call_id, name, arguments }` por tool call |
| `tool` | `{ type: 'function_call_output', call_id, output }`; `isError` usa o prefixo `Tool error: ` |
| `tools` | Formato plano: `{ type: 'function', name, description?, parameters }` |
| `tool_choice` | `'auto'`, `'none'`, `'required'`; `{ name }` → `{ type: 'function', name }` |
| `text.format` | Com `structuredOutput: 'text_format'`: `{ type: 'json_schema', name, strict, schema }`. Outro valor: `unsupported` |
| `reasoning` | Com `reasoningFormat: 'reasoning_object'`: `{ effort }`. `maxTokens` e `exclude`: `unsupported` |
| `max_output_tokens`, `temperature` | Como no outro fio, pelas regras de compat |
| `store` | `false` só com `compat.supportsStore` |
| `stop`, `cachedContent` | `unsupported`: a Responses API não tem esses campos |
| `stream` | `true` |

**`parseStream`:**

| Evento | Saída |
|---|---|
| `response.output_text.delta` | `text` |
| `response.reasoning_summary_text.delta` | `reasoning` |
| `response.output_item.added` com `function_call` | guarda `call_id` e `name` pelo `item.id` |
| `response.function_call_arguments.delta` | acumula |
| `response.output_item.done` com `function_call` | `tool_call` com os argumentos finais |
| `response.completed` | `finishReason: 'stop'`, ou `tool_calls` se houve tool call; uso |
| `response.incomplete` | `finishReason: 'length'` com `max_output_tokens`, `content_filter` com `content_filter`; uso |
| `response.failed` | `errorFromStatus` pelo `response.error`. Sem código: `upstream` |
| `error` | Idem |
| Stream acaba sem evento final | `upstream` |

**Uso:** `input = input_tokens − input_tokens_details.cached_tokens`, `output = output_tokens`, `cacheRead = cached_tokens`, `reasoning = output_tokens_details.reasoning_tokens`, `raw`.

**Testes:** uma por linha das duas tabelas, mais o caso de stream com tools junto.

Mensagem de commit: `feat(responses): fio openai-responses`.

### Task 5.2: fixtures reais (controller)

Modelo: `gpt-5.4-nano`, conta OpenAI com `compat: { structuredOutput: 'text_format', reasoningFormat: 'reasoning_object' }`. Custo estimado: menos de US$ 0,01. Grave por cima de `text.sse`, `tool-call.sse` e `structured.sse`. Divergência é correção no fio.

### Fim da Fase 5

- [ ] `npm test` e `npx tsc --noEmit -p tsconfig.json`.
- [ ] Revisão de fase pelo `reviewer-deepseek`. Pergunte especificamente: o que o `openai.js` do Igris envia que este fio não envia? Isso impede a E4?

---

## Entrega

### Task 6.1: smoke, tipos e documentos (controller)

**Files:** `scripts/smoke.mjs`, `types/**`, `README.md`, `CHANGELOG.md`, `package.json`, `docs/pendencias/2026-10-31-lib-providers-nucleo.md`.

- [ ] Estender `scripts/smoke.mjs` para a matriz da §8 da spec, pulando provedor sem chave.
- [ ] Rodar: `node --env-file=/e/Projetos/igris-gateway/.env scripts/smoke.mjs`. Custo estimado: menos de US$ 0,10. Espera: `OK smoke`.
- [ ] `npm run build:types` e `npm test` e `npm run typecheck`.
- [ ] README com um exemplo de cada operação e um `compat` por provedor (OpenRouter, OpenAI, Groq, TypeSafe, Google).
- [ ] CHANGELOG `0.2.0`, incluindo a mudança de `operations` no catálogo como quebra.
- [ ] `package.json` em `0.2.0`.
- [ ] Atualizar as pendências: marcar as resolvidas e acrescentar a saída multimodal no chat como necessária para a E4.

### Revisão do conjunto (`reviewer-opus`)

Prompt dirigido, com a spec, este plano e `git diff main...HEAD`. Perguntas obrigatórias:

1. Para cada adapter do Gateway (`openai`, `openrouter`, `anthropic`, `google`, `groq`, `typesafe`): existe algo que ele faz e a lib não, fora da lista T5/T6 da spec? Critério da spec: nenhum código de provedor fora da lib.
2. Toda chamada única erra com tipo, e todo corpo é lido uma vez só?
3. Alguma fixture contém chave ou dado pessoal?
4. O `chat` de `v0.1.0` mudou de comportamento em algo que o Gateway já consome?

Correção de achado segue em rodadas numeradas, até aprovar.

### Task 6.2: merge e tag (controller)

- [ ] `git switch main && git merge --no-ff feature/t1.2`.
- [ ] `npm test`.
- [ ] `git tag -a v0.2.0 -m "v0.2.0 — operações e fio Google"`.
- [ ] `git push origin main v0.2.0`.
- [ ] Conferir: `curl -sIL -o /dev/null -w "%{http_code}\n" https://github.com/PatrickCavalcanti/ok-gateway-providers/archive/refs/tags/v0.2.0.tar.gz` responde `200`.

---

## Critério de pronto

Os da §11 da spec, mais: revisão do conjunto aprovada por escrito.
