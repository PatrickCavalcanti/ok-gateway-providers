# ok-gateway-providers — T1.1 núcleo — Plano de implementação

**Goal:** a lib pública `ok-gateway-providers` fala com provedores de IA a partir de
conta + modelo + pedido e devolve eventos, uso normalizado, custo em US$ e erro tipado,
com os fios `openai-completions` e `anthropic-messages` (operação `chat`).

**Spec:** `docs/superpowers/specs/2026-10-30-lib-providers-nucleo-design.md` (a §15 traz
os ajustes feitos ao escrever este plano e vale sobre o texto anterior).

**Tech stack:** Node ≥ 20, ESM puro, zero dependência de runtime, `node:test`, JSDoc com
`checkJs` estrito, `.d.ts` gerado por `tsc`.

**Modo:** dev-early, no automático por decisão do dono (2026-10-31): ele não revisa o
plano; a sessão planeja, implementa, revisa e entrega. Fica com ele: o smoke contra
provedores reais (precisa das chaves) e a tag `v0.1.0`.

**Branch:** `claude/awesome-rubin-mmewif` no repositório novo, push ao fim de cada fase.

---

## Regras para quem implementa (todo subagente)

- Trabalhe em `/home/user/ok-gateway-providers`. Confira `git rev-parse --show-toplevel`.
- **Passo zero:** os contratos da seção "Contratos" abaixo já existem em código depois da
  Fase 1. Se o código divergir deste plano, devolva **BLOCKED** com o que encontrou.
- **Não commite.** Devolva a lista de paths e a mensagem de commit proposta.
- Rode só os testes que a task escreveu, em primeiro plano:
  `node --test --test-force-exit test/<arquivo>.test.js`. E `npx tsc --noEmit -p .` no fim.
- Sem dependência nova. Sem rede: todo teste injeta `fetch` falso.
- Proibido git destrutivo (`checkout --`, `stash`, `reset`, `restore`, `clean`).
- Identificadores em inglês; comentários e mensagens de erro em português.
- Fonte de consulta (somente leitura): `/home/user/igris/packages/providers/src/**`
  (Igris) e `/home/user/igris-gateway/src/**` (Gateway). Reescrever, não portar linha a
  linha (D4).
- Texto do plano contradiz o critério de verificação → siga o critério e relate.

---

## Contratos (fixados na Fase 1; as fases seguintes só consomem)

### Erros — `src/errors.js`

```js
class ProviderError extends Error {
  // type: 'auth'|'rate_limit'|'invalid_request'|'upstream'|'timeout'|'unsupported'|'aborted'
  constructor({ type, message, retryOther, emitted = false, status, provider, model, body, cause })
}
errorFromStatus(status, { provider, model, body })   // 401/403 auth, 429 rate_limit, 400/404/422 invalid_request, 5xx upstream, outro 4xx invalid_request
unsupported(message, { provider, model })             // type 'unsupported', retryOther true
truncateBody(text)                                    // até 2 KB
```

`retryOther` é `false` só em `aborted`. `body` guarda no máximo 2 KB.

### Timeouts — `src/timeouts.js`

`createDeadline({ timeouts, signal })` → `{ signal, touch(), clear(), reason() }`. Cria um
`AbortController` próprio, ligado ao `signal` do chamador. O primeiro byte arma ao criar;
`touch()` (cada chunk) desarma o primeiro byte e rearma a inatividade; o total arma ao
criar se houver. `reason()` → `null | 'aborted' | 'first_byte' | 'idle' | 'total'`.
Padrões: `firstByteMs 60000`, `idleMs 60000`, `totalMs` sem limite.

### SSE — `src/sse.js`

`async function* readSSE(body, { onChunk })` — `body` é `ReadableStream<Uint8Array>` (ou
async iterable). Aceita `\n` e `\r\n`, várias linhas `data:` por evento, comentários `:`.
Rende `{ event?, data }`. Chama `onChunk()` a cada pedaço lido (para o `touch`).

### Compat — `src/compat.js`

`resolveCompat(account, model)` → objeto completo: padrão do fio (`DEFAULT_COMPAT[api]`)
← `account.compat` ← `model.compat`, campo a campo; `headers` faz merge.
Padrão `openai-completions`: `maxTokensField 'max_tokens'`, `supportsDeveloperRole false`,
`supportsStore false`, `supportsTemperature true`, `reasoningFormat 'none'`,
`thinkingByDefault false`, `structuredOutput 'none'`, `usageInStream false`,
`providerRouting false`, `cacheMarker 'none'`, `headers {}`.
Padrão `anthropic-messages`: `maxTokensField 'max_tokens'`, `supportsTemperature true`,
`reasoningFormat 'anthropic_thinking'`, `thinkingByDefault false`,
`structuredOutput 'output_config'`, `usageInStream true`, `cacheMarker 'cache_control'`,
os demais como acima.

### Fio — `src/apis/<api>.js`

Cada fio exporta:

```js
export const api = 'openai-completions';
/** Monta o pedido HTTP. Puro (exceto anexos, que validam). Lança ProviderError 'unsupported'. */
export function buildRequest({ account, model, compat, request, apiKey }) → { url, headers, body }
/** Lê o stream SSE e rende eventos; devolve o resumo no `return`. */
export async function* parseStream(sseEvents, { model, compat }) →
  yields { type: 'text', text } | { type: 'reasoning', text } | { type: 'tool_call', id, name, arguments }
  returns { finishReason, usage, reportedCostUsd }   // usage já normalizado
/** Erro de corpo dentro do stream (ex.: `{ error: {...} }` ou `event: error`) → lance via errorFromStatus/ProviderError. */
```

`finishReason`: `'stop'|'length'|'tool_calls'|'content_filter'|'error'|string` (o que o
provedor disse, mapeado quando conhecido).

### Uso e custo

`usage = { input, output, cacheRead, cacheWrite, cacheWrite1h, reasoning?, audioSeconds?, raw }`
— `input` sem o cache lido nem gravado; `raw` é o objeto do provedor.
`computeCost(model, usage, reportedUsd?)` → `{ usd: number|null, source: 'provider'|'table'|'none' }`.

### Cliente — `src/client.js`

`createClient({ account, model, fetch? })` → `{ chat(request) }`. `chat` devolve um `Run`:
async iterable de eventos (`text`, `reasoning`, `tool_call`, `end`) com `run.result`
(Promise de `{ finishReason, usage, cost }`). O stream começa na criação e os eventos ficam
numa fila; `result` rejeita com o mesmo `ProviderError` que a iteração lança (e nunca
gera unhandled rejection). `emitted` vira `true` depois do primeiro evento produzido.
Valida o modelo contra o pedido **antes** do fetch: `model.operations` sem `chat` → 
`unsupported`. `apiKey` função é chamada a cada pedido.

---

## Fase 1 — infraestrutura e contratos (controller, sequencial)

- [ ] **T1.1 Esqueleto do repositório:** `package.json` (`name ok-gateway-providers`,
  `type module`, `engines node>=20`, `exports`/`types` para `types/index.d.ts`, scripts
  `test`, `typecheck`, `build:types`), `tsconfig.json` (`checkJs`, `strict`, `noEmit`),
  `tsconfig.types.json` (declaração em `types/`), `LICENSE` MIT, `.gitignore`,
  `README.md` provisório, `CHANGELOG.md`, `.github/workflows/ci.yml` (Node 20 e 22,
  `npm ci`, `npm test`, `npm run typecheck`).
- [ ] **T1.2 `vocabulary.js` + teste:** `OPERATIONS`, `INPUT_MODALITIES`,
  `OUTPUT_MODALITIES`, `METHODS_BY_OPERATION`, `formatShape`, `parseShape`, `shapeOf`,
  `normalizeRequest`, `requestKey`, `parseRequestKey`, `ineligibilityReason`
  (`missing_operation` · `missing_input` · `missing_output`), `isEligible`,
  `VocabularyError` (`code 'InvalidVocabulary'`). Casos portados de
  `igris/packages/providers/test/vocabulario.test.js` (sem os de capability legada).
- [ ] **T1.3 `types.js`, `errors.js`, `timeouts.js`, `sse.js`, `compat.js` + testes.**
- [ ] **T1.4 `client.js` e `index.js`** com um fio de teste (fake) nos testes do cliente:
  fila de eventos, `result`, `emitted`, timeouts, abort, status HTTP → erro, validação de
  operação, `apiKey` função.

Verificação: `npm test` e `npm run typecheck` verdes. Commit + push.

## Fase 2 — fios, custo e catálogo (subagentes, paralelo — arquivos disjuntos)

- [ ] **T2.1 `attachments.js` + `apis/openai-completions.js` + testes** (Sonnet).
  Partes por transporte (`data-url`/`url` para imagem, `input_audio`, `input_video` /
  `video_url`); `unsupported` antes do fetch quando a `input` do modelo ou o transporte
  não cobre. Corpo: `messages` (system como `system`, ou `developer` com
  `supportsDeveloperRole`), `tools`, `tool_calls` acumulados por `index`,
  `response_format` / `json_schema` no topo / nada conforme `structuredOutput`,
  `reasoning_effort` / `reasoning: { effort }` conforme `reasoningFormat`,
  `stream_options.include_usage` com `usageInStream`, `maxTokensField`, `temperature`
  só com `supportsTemperature`, `cache_control` nas partes marcadas com
  `cacheMarker 'cache_control'`, `params` por último sem sobrescrever `model`,
  `messages`, `stream`, `tools`, `response_format`, e `provider` só com `providerRouting`.
  Uso: `prompt_tokens - cached_tokens - cache_write_tokens`, `cached_tokens`, `usage.cost`.
  Fixtures SSE em `test/fixtures/openai-completions/`. Matriz de compat:
  `test/openai-completions.compat.test.js`.
- [ ] **T2.2 `apis/anthropic-messages.js` + testes** (Sonnet). `system` em blocos com
  `cache_control` (ttl `1h` quando pedido), `tool_use`/`tool_result` (papel `tool` vira
  `tool_result` numa mensagem `user`; mensagens `tool` seguidas se juntam), imagem
  `source base64|url`, áudio/vídeo `unsupported`, `thinking` `adaptive`/`disabled` +
  `output_config.effort`, `output_config.format` para o schema, `max_tokens` 1024 ou
  16000 com `thinkingByDefault`, `temperature` omitida com thinking ligado, header
  `anthropic-version: 2023-06-01` e `x-api-key`. Stream: `message_start`,
  `content_block_*` (texto, `thinking_delta`, `input_json_delta`), `message_delta`
  (stop_reason, usage), `error`. Uso: `cache_read_input_tokens`,
  `cache_creation.ephemeral_5m/1h_input_tokens` (ou `cache_creation_input_tokens` como
  5 min). Fixtures em `test/fixtures/anthropic-messages/`.
- [ ] **T2.3 `cost.js`, `credits.js`, `catalog/openrouter.js` + testes** (Sonnet).
  Regras da spec §9–§10 e §15 itens 3, 4 e 6. Conferir os números contra
  `igris-gateway/src/credits/pricing.ts` (Haiku 5.5 com contexto longo, cache 1 h, áudio
  com mínimo do Groq). Catálogo: fixture reduzida de `/api/v1/models` (montada à mão a
  partir do formato real; sem rede), operações derivadas como no Igris
  (`client/preencher-modelo.js`, `listasDoCatalogoOpenRouter`), preço string US$/token →
  US$/milhão, `reasoning` e `compat.structuredOutput` de `supported_parameters`
  (`structured_outputs` → `response_format`; só `response_format` → `none`, porque dá JSON
  bem formado com o formato errado), `usageInStream: true`, `reasoningFormat
  'reasoning_object'` quando houver `reasoning`, `providerRouting: true`, campos extras
  (inclusive o bloco `gateway`) em `model.meta`.

Integração (controller): `client.js` registra os dois fios, `index.js` exporta tudo.
Revisão de fase (subagente Sonnet, spec + qualidade). Commit + push.

## Fase 3 — scripts, tipos e documentação (controller)

- [ ] **T3.1 `scripts/record-fixture.mjs`** (chave do ambiente; remove headers e chaves
  antes de salvar) e **`scripts/smoke.mjs`** (texto, tool call e imagem contra
  OpenRouter e Anthropic; pula provedor sem chave e diz isso).
- [ ] **T3.2 `npm run build:types`** gera `types/`, que entra no commit.
- [ ] **T3.3 README** com conta, modelo, chat, eventos, custo, créditos, erros e
  instalação pelo tarball; `CHANGELOG` com a `0.1.0`.

## Entrega

- [ ] Revisão do conjunto (Opus) contra a spec, com as oito formas do
  `dev-process` aplicáveis (o que a spec pede e não está; o que está e a spec não pede;
  erro silencioso; contrato inventado; teste que passa pelo caminho errado; tipo frouxo;
  segredo em fixture; divergência de nome). Corrigir e re-rodar até limpo.
- [ ] `npm test` + `npm run typecheck` verdes. Push.
- [ ] Fica com o dono: `scripts/smoke.mjs` com as chaves, tag `v0.1.0`, e decidir o
  branch padrão do repositório (o primeiro push foi o deste branch).
