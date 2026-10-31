# Lib de providers `ok-gateway-providers` — T1.1: núcleo

**Data:** 2026-10-30
**Status:** aprovado pelo dono no brainstorm (visão, seção 2). Esta spec detalha o núcleo.
**Visão:** [2026-10-30-providers-lib-e-gateway-visao-design.md](2026-10-30-providers-lib-e-gateway-visao-design.md) (D1–D13)
**Primeiro consumidor:** Igris Gateway, na entrega T2.2. O Igris só vem depois (E3/E4).

## 1. Objetivo

Criar a lib pública que fala com provedores de IA a partir de três entradas: uma **conta**,
um **modelo** e um **pedido** no vocabulário de operação + forma. A lib devolve eventos,
uso normalizado, custo em dólar e erro tipado. Ela não guarda nada, não roteia e não
repete chamadas.

O núcleo cobre:

- vocabulário e formato de dados;
- os fios `openai-completions` e `anthropic-messages`, só a operação `chat`, com tools,
  saída estruturada, raciocínio e anexos de imagem, áudio e vídeo;
- compat declarado;
- uso, custo e conversor de créditos;
- erros;
- leitor de catálogo no formato OpenRouter;
- marcadores de cache;
- a infraestrutura do repositório.

Ficam para a **T1.2**:

- `openai-responses` e `google-generative-ai`;
- embeddings, STT, TTS, imagem e `decision`;
- `cachedContent`.

## 2. Repositório e distribuição

- **Pasta local:** `E:\Projetos\ok-gateway-providers` (ou o clone da sessão na nuvem), um repositório git próprio. Fica fora do
  Igris e do Gateway.
- **Remoto:** `github.com/PatrickCavalcanti/ok-gateway-providers`, público, licença MIT.
  O dono criou o remoto em 2026-10-31 (público, vazio) e autorizou trabalhar e enviar
  direto nele — ver §15.
- **Pacote:** `ok-gateway-providers`, com `"type": "module"`, Node 20 ou mais novo, **zero
  dependência de runtime** (usa o `fetch` nativo). As dependências de desenvolvimento são
  `typescript` e `@types/node`.
- **Tipos:** JSDoc com `checkJs` estrito. Um `.d.ts` é gerado em `types/` por
  `npm run build:types` (`tsc --declaration --emitDeclarationOnly`) e entra no commit de
  cada versão. `package.json` aponta `exports` e `types` para lá.
- **Como os consumidores instalam:** pela URL do tarball da tag no GitHub, por exemplo
  `"ok-gateway-providers": "https://github.com/PatrickCavalcanti/ok-gateway-providers/archive/refs/tags/v0.1.0.tar.gz"`.
  Isso funciona no `npm ci` da imagem `node:20-slim` do Gateway, que não tem git, e
  também no pnpm do Igris. Publicar no npm fica opcional, para depois.
  - **Em desenvolvimento, antes do remoto:** o consumidor usa `file:` para a pasta local.
    Esse uso fica só na worktree e nunca vai para commit.
- **Versão:** semver, com `0.x` enquanto os trens andam. O consumidor fixa a tag exata.
  O `CHANGELOG.md` registra o que mudou e o que quebra.
- **CI:** GitHub Actions com `npm test` e `npm run typecheck` a cada push. Entra quando o
  remoto existir.
- **Idioma:** os identificadores e campos são em **inglês**, para manter o formato do
  pi-ai e o vocabulário do OpenRouter. O README e os comentários são em português.

> Ajuste em relação à apresentação da seção 2 do brainstorm: lá os campos apareceram em
> português (`nome`, `custo`, `fio`). Aqui viram `name`, `cost` e `api`, como no pi-ai,
> para que um fio possa ser delegado ao pi-ai sem converter dado.

## 3. Estrutura

```
ok-gateway-providers/
  src/
    index.js                 exports públicos
    vocabulary.js            operações, modalidades, forma, elegibilidade
    types.js                 typedefs JSDoc (Account, Model, ChatRequest, Event, Usage…)
    client.js                createClient({ account, model, fetch? })
    errors.js                ProviderError + classificação
    timeouts.js              primeiro byte, inatividade, total (AbortController próprio)
    sse.js                   leitor de SSE
    attachments.js           conteúdo → partes por transporte
    cost.js                  usage → custo US$ (provedor > tabela > none)
    credits.js               createCreditConverter
    catalog/openrouter.js    /models no formato OpenRouter → Model[]
    apis/
      openai-completions.js  fio Chat Completions (+ compat)
      anthropic-messages.js  fio Messages (+ compat)
  test/
    fixtures/<api>/<caso>.sse|.json   respostas gravadas, sem chave
    *.test.js
  scripts/
    record-fixture.mjs       grava uma fixture com chave real e apaga a chave
    smoke.mjs                confere provedores reais antes de uma versão (manual)
  types/                     .d.ts gerado
```

## 4. Dados

```js
/** @typedef {{
 *   id: string, provider: string,              // 'openrouter', 'anthropic', 'inception', 'igris-gateway'…
 *   api: 'openai-completions'|'anthropic-messages'|'openai-responses'|'google-generative-ai',
 *   baseUrl: string,
 *   apiKey: string | (() => Promise<string>),  // função: token renovável (Firebase no Gateway)
 *   headers?: Record<string,string>,
 *   compat?: Compat,                           // padrão da rota; o modelo sobrescreve
 *   timeouts?: { firstByteMs?: number, idleMs?: number, totalMs?: number },
 * }} Account */

/** @typedef {{
 *   id: string, name?: string,
 *   operations: Operation[],                   // ['chat'] no núcleo
 *   input: InputModality[], output: OutputModality[],
 *   reasoning?: boolean, contextWindow?: number, maxTokens?: number,
 *   cost?: Cost, compat?: Compat, transport?: Transport,
 *   params?: Record<string, unknown>,          // passthrough para o corpo (chaves protegidas não passam)
 * }} Model */

/** @typedef {{                                 // US$ por milhão de tokens (formato pi-ai + extensões)
 *   input: number, output: number, cacheRead?: number, cacheWrite?: number,
 *   cacheWrite1h?: number, audioPerSecond?: number, minBilledSeconds?: number,
 *   tiers?: { aboveInputTokens: number, input: number, output: number, cacheRead?: number }[],
 * }} Cost */
```

`vocabulary.js` é a fonte do vocabulário. Ele porta `packages/providers/src/vocabulario.js`
do Igris, com identificadores em inglês:

- `OPERATIONS`, `INPUT_MODALITIES`, `OUTPUT_MODALITIES`;
- `shapeOf(model)`, que devolve `text+image->text` em ordem canônica;
- `parseShape`, `requestKey`, `isEligible(model, request)` e
  `ineligibilityReason(model, request)`;
- `METHODS_BY_OPERATION`.

## 5. Pedido, eventos e retorno

```js
const client = createClient({ account, model });          // fetch injetável em teste
const run = client.chat({
  system,          // string | { text, cache?: { ttl: '5m'|'1h' } }[]
  messages,        // { role: 'user'|'assistant'|'tool', content: Part[], toolCalls?, toolCallId? }[]
  tools,           // { name, description, parameters }[]
  responseSchema,  // { name?, schema, strict? }
  effort,          // 'none'|'low'|'medium'|'high'|'xhigh'
  maxTokens, temperature, params,                          // params: passthrough por chamada
  signal,
});
for await (const ev of run) { /* ver tabela */ }
const { usage, cost, finishReason } = await run.result;
```

`Part` é um destes:
- `{ type: 'text', text, cache? }`
- `{ type: 'image', data | url, mime }`
- `{ type: 'audio', data, format }`
- `{ type: 'video', data | url, mime }`

| Evento | Campos |
|---|---|
| `text` | `text` (delta) |
| `reasoning` | `text` (delta), quando o fio expõe |
| `tool_call` | `id`, `name`, `arguments` (string JSON **completa**, acumulada pelo fio) |
| `end` | `finishReason`, `usage`, `cost` |

O `usage` tem os campos `input` (sem o cache lido), `output`, `cacheRead`, `cacheWrite`,
`cacheWrite1h`, `reasoning?` e `raw`.

## 6. Compat

Cada campo do compat substitui um `if` de hoje. A conta traz o padrão e o modelo
sobrescreve campo a campo.

| Campo | Valores | Substitui (hoje) |
|---|---|---|
| `maxTokensField` | `max_tokens` · `max_completion_tokens` · `max_output_tokens` | ramo `apiStyle` em `openai.js:429` |
| `supportsDeveloperRole` | bool (padrão **false**) | — (lição do pi-ai: endpoint desconhecido não é a OpenAI oficial) |
| `supportsStore` | bool (padrão **false**) | idem |
| `supportsTemperature` | bool | regex `thinksByDefault` (Igris `anthropic.js:74`, Gateway `anthropic.ts`) |
| `reasoningFormat` | `reasoning_effort` · `reasoning_object` · `anthropic_thinking` · `none` | ramos de effort em `openai.js:317…`, `openrouter.js:320`, `anthropic.js:182`, `esforco.js` |
| `thinkingByDefault` | bool (Anthropic) | regex `thinksByDefault`, que passa a ser dado do modelo |
| `structuredOutput` | `response_format` · `top_level_json_schema` · `output_config` · `none` | `_ehApiOficialDaOpenAI` (`openai.js:215`), allowlists do OpenRouter e do Groq, `supportsStructuredOutputsFor` em 7 protocolos, F15 |
| `usageInStream` | bool | `stream_options.include_usage` (`openai.js:419`, `openrouter.js:516`) |
| `providerRouting` | bool: aceita o objeto `provider` do OpenRouter em `params` | `ProviderRouting` do Gateway |
| `cacheMarker` | `cache_control` · `prompt_cache_breakpoint` · `none` | `anthropic-cache`, `openai-cache` (só o marcador; o plano é do cliente) |
| `headers` | objeto (`HTTP-Referer`, `X-Title`, `anthropic-workspace-id`…) | headers fixos nos adapters |

A conta genérica `openai-completions` usa `max_tokens`, sem developer, sem store, sem
saída estruturada, com `usageInStream` falso e `cacheMarker: none`. Quem cadastra liga o
que o endpoint suporta. O leitor de catálogo liga sozinho o que o OpenRouter declara em
`supported_parameters`.

## 7. Anexos (parte 3)

`transport` do modelo:
- `image`: `['data-url','url']` (padrão), um dos dois ou `[]`;
- `audio`: `input_audio` · `null`;
- `video`: `input_video` · `video_url` · `null`.

Regras:
- Uma parte de mídia que a `input` do modelo não declara, ou que o transporte não
  suporta, dá `ProviderError { type: 'unsupported', retryOther: true }` **antes** do fetch.
  Nada é descartado em silêncio.
- URL num modelo que só aceita `data-url` também dá `unsupported`. Baixar a URL é papel do
  cliente.
- Na Anthropic, imagem vai em `source: base64|url`. Áudio e vídeo dão `unsupported`.

## 8. Erros e timeouts

`ProviderError { type, retryOther, emitted, status?, provider, model, body? (até 2 KB), cause? }`.

| Situação | `type` | `retryOther` |
|---|---|---|
| 401, 403 | `auth` | true |
| 429 | `rate_limit` | true |
| 400, 404, 422 do provedor | `invalid_request` | true (outro modelo pode aceitar) |
| 5xx, rede | `upstream` | true |
| timeout (primeiro byte, inatividade, total) | `timeout` | true |
| mídia ou parâmetro que o modelo não suporta | `unsupported` | true |
| `signal` do chamador abortou | `aborted` | false |
| erro de corpo dentro do stream | conforme o código, com `emitted: true` se já saiu evento | — |

`emitted` diz se algum evento já foi entregue ao chamador. O consumidor só passa ao
próximo alvo com `retryOther && !emitted`. A lib **não repete** chamada.

Os timeouts vêm de `account.timeouts`. A lib cria um `AbortController` próprio ligado ao
`signal` do chamador. Os padrões são: primeiro byte em 60 s, inatividade de stream em
60 s, sem limite total. Os valores atuais do `gateway.js` do Igris servem de referência
no plano.

## 9. Custo e créditos

`cost.js` calcula `computeCost(model, usage, reportedUsd?)` e devolve
`{ usd, source: 'provider'|'table'|'none' }`:

- **`provider`:** o fio repassa o custo que o provedor informou (`usage.cost` no
  OpenRouter), e ele vence.
- **`table`:** o custo é calculado pelo `model.cost`. As faixas usam o input total. O
  cache lido e gravado (5 min e 1 h) é cobrado à parte. Áudio é por segundo, respeitando
  o `minBilledSeconds`.
- **`none`:** o modelo não tem `cost`. Aparece `usd: null`, nunca um valor inventado.

`credits.js` oferece `createCreditConverter({ creditsPerUsd, rounding: 'ceil'|'round'|'none' })`,
que devolve `{ toCredits(usd) }`. Valor `null` continua `null`. O Gateway configura
5.500 créditos por dólar e o arredondamento atual dele; o plano confere em
`src/credits/pricing.ts`. O Igris não cria o conversor.

## 10. Catálogo

`catalog/openrouter.js` oferece `parseOpenRouterModels(json)`, que devolve `Model[]`:

- As modalidades vêm de `architecture.input_modalities` e `output_modalities`. As
  operações são derivadas como em `modalidadesDoOpenRouter`, no Igris
  (`packages/providers/src/catalog/openrouter-models.js`).
- O `cost` converte `pricing` de US$/token (string) para US$/milhão.
- `reasoning` e `compat.structuredOutput` saem de `supported_parameters`.
- O mesmo leitor serve ao catálogo do Gateway (`GET /v1/models`). O bloco `gateway` é
  preservado em `model.meta`.

## 11. Fios do núcleo

**`openai-completions`** cobre a OpenAI em estilo chat, o OpenRouter, o Groq, o Ollama
(`/v1`), a Inception (Mercury), o DeepSeek, o llama.cpp e o Gateway novo.
- SSE de `/chat/completions`. Os `tool_calls` são acumulados por `index`.
- Lê `reasoning`/`reasoning_content` quando vierem.
- `usage` do último chunk, incluindo `prompt_tokens_details.cached_tokens` e `usage.cost`.
- `params` entram por último, sem sobrescrever `model`, `messages`, `stream`, `tools`
  nem `response_format`.

**`anthropic-messages`**:
- `system` em blocos, com `cache_control` nos blocos marcados.
- `tool_use` e `tool_result`; o papel `tool` vira bloco `tool_result` dentro de uma
  mensagem `user`.
- `thinking` adaptativo ou desligado, conforme o compat, com `output_config.effort`.
- `max_tokens` padrão: 1024, ou 16000 com `thinkingByDefault`.
- Uso com `cache_creation_input_tokens` e `cache_read_input_tokens`, e a escrita de 1 h
  separada quando vier.

## 12. Testes

- **Offline e determinísticos.** Cada caso injeta um `fetch` falso que devolve uma
  fixture gravada.
- **Casos por fio:**
  - texto simples;
  - tool call fragmentada;
  - raciocínio;
  - saída estruturada;
  - imagem `data-url` e `url`;
  - mídia não suportada;
  - 401, 429 e 500;
  - erro no meio do stream (`emitted: true`);
  - timeout de primeiro byte e de inatividade;
  - abort do chamador;
  - custo informado pelo provedor e custo pela tabela.
- **Matriz de compat:** o mesmo pedido, com compat diferente, gera o corpo esperado.
- **`vocabulary`:** os casos de `packages/providers/test/vocabulario.test.js` do Igris,
  portados.
- **`catalog`:** uma fixture real de `/api/v1/models`, reduzida.
- **`credits` e `cost`:** faixas, cache 1 h, áudio com mínimo e `null`.
- **`scripts/record-fixture.mjs`:** grava a fixture a partir de uma chamada real, com a
  chave vinda do ambiente, e **remove headers e chaves** antes de salvar.
- **`scripts/smoke.mjs`:** manual, com as chaves do ambiente. Roda antes de cada tag.
- `npm test` roda `node --test --test-force-exit`, e `npm run typecheck` roda
  `tsc --noEmit`.

## 13. Fora desta entrega

- T1.2: os fios `openai-responses` e `google-generative-ai`, as operações além de `chat`
  e o `cachedContent`.
- Retry, fallback, roteamento, armazenamento e planejadores de cache. São do cliente,
  pela visão.
- Upload de arquivo (Files API).
- Publicar no npm.

## 14. Critério de pronto

- [ ] `npm test` e `npm run typecheck` verdes no repositório local.
- [ ] `types/` gerado e coerente com o JSDoc.
- [ ] README com um exemplo de conta, modelo, chat, custo e créditos.
- [ ] `scripts/smoke.mjs` rodado pelo dono ou com a autorização dele, contra OpenRouter e
  Anthropic: texto, tool call e imagem.
- [ ] Tag `v0.1.0` local. O push para o GitHub só acontece com o "sim" do dono.

## 15. Ajustes feitos ao escrever o plano (2026-10-31)

Valem sobre o texto anterior.

1. **Nome.** Repositório `PatrickCavalcanti/ok-gateway-providers` e pacote
   `ok-gateway-providers` (sem escopo). O dono pode renomear depois; a URL do tarball
   segue o nome do repositório.
2. **Remoto desde o início.** O trabalho roda numa sessão na nuvem, que se perde se não
   for enviada; o dono criou o repositório e autorizou o push a cada fase. A tag `v0.1.0`
   continua dependendo do smoke (§14).
3. **Faixas de preço.** O `Cost.tiers` cobre o `longContext` do Gateway
   (`{ thresholdTokens, multiplier }`): a faixa vale quando o **prompt total**
   (`input + cacheRead + cacheWrite + cacheWrite1h`) passa de `aboveInputTokens`, e
   substitui **todas** as taxas que declara; taxa que a faixa não declara fica a base.
   O Haiku 5.5 se escreve como uma faixa com as taxas × 5.
4. **Cache sem preço.** `cacheRead`, `cacheWrite` e `cacheWrite1h` ausentes são cobrados
   como `input` — a lib não inventa desconto. Os padrões do Gateway (10 %, 125 %, 200 %)
   viram valores explícitos na migração de preços da T2.1.
5. **Escrita de cache disjunta.** `usage.cacheWrite` é a escrita de 5 min e
   `usage.cacheWrite1h` a de 1 h; não se sobrepõem (no Gateway o 1 h era subconjunto).
6. **Arredondamento de créditos.** `createCreditConverter({ creditsPerUsd, rounding,
   decimals })`: `rounding: 'ceil'|'round'|'none'`, `decimals` (padrão 0). O Gateway de
   hoje é `{ creditsPerUsd: 5500, rounding: 'round', decimals: 6 }`.
7. **Timeouts padrão.** Primeiro byte 60 s e inatividade 60 s, como na §8; o Igris usa
   120 s de inatividade e 600 s de total no chat do Gateway (`gateway.js`) — o cliente
   passa isso na conta.
8. **Arquivo `compat.js`.** O compat resolvido (padrão do fio ← conta ← modelo) mora num
   módulo próprio, para o teste de matriz não depender do fio.
9. **Métodos por operação** usam os nomes da lib: `chat`, `decide`, `embed`,
   `transcribe`, `speak`, `generateImage`. As funções de capability legada do Igris não
   vêm para a lib.

### 15.1 Ajustes da revisão do conjunto (2026-10-31)

10. **Uso não declarado.** `usage.missing: true` quando o provedor não manda uso; o custo
    pela tabela vira `{ usd: null, source: 'none' }`, nunca US$ 0.
11. **`max_tokens`.** Nunca cai em `model.maxTokens` (o catálogo preenche o máximo do
    modelo e o OpenRouter responde 402/400). Na Anthropic, sem `maxTokens` no pedido: 16000
    sempre que o thinking vai rodar (`effort` ≠ `none`, ou `thinkingByDefault` sem
    `effort: 'none'`), senão 1024 — mais largo que a §11, igual ao Igris e ao Gateway.
12. **Tool call cortada** (limite de tokens ou JSON que não fecha) é erro `upstream`, nos
    dois fios; na Anthropic as `tool_call` saem no fim da mensagem.
13. **Pedido malformado** é `invalid_request` com `retryOther: false`; falha da função
    `apiKey` é `auth`.
14. **OpenRouter com schema** manda `provider.require_parameters: true` (com
    `providerRouting`). O catálogo declara `transport.video = 'video_url'` e
    `transport.audio = 'input_audio'`.
15. **Headers** se fundem sem diferença de caixa: conta ← compat (conta ← modelo) ← fio.
