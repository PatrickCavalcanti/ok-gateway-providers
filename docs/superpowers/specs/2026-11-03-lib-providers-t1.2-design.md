# `ok-gateway-providers` — T1.2: as outras operações e os fios que faltam

**Data:** 2026-11-03
**Status:** escrita para revisão do dono.
**Base:** `v0.1.0` (T1.1). Visão: `docs/superpowers/specs/2026-10-30-providers-lib-e-gateway-visao-design.md`, decisões D1–D13.
**Quem usa:** o Igris Gateway na T2.2, trocando os 6 adapters pela lib. O Igris na E4.
**Versão de saída:** `v0.2.0`.

## 1. Objetivo

Hoje a lib só faz `chat`, em dois fios, e só entende resposta SSE. A T1.2 entrega:

- as operações `embeddings`, `transcription`, `speech`, `image-generation` e `decision`;
- o fio `google-generative-ai`, com a referência `cachedContent`;
- o fio `openai-responses`;
- três lacunas do contrato de chat: `tool_choice`, `is_error` no resultado de tool e a ida e volta do raciocínio assinado;
- fixtures gravadas de provedores reais.

**Critério que manda:** depois da T1.2, nenhum dos 6 adapters do Gateway precisa de código de provedor fora da lib. O cache planejado continua no Gateway.

## 2. Decisões de desenho

| # | Decisão | Por quê |
|---|---|---|
| T1 | Operações além de `chat` são **chamada única**: `Promise<Result>`, sem `Run` nem eventos. | É como os adapters já funcionam. Nenhuma delas faz stream hoje. |
| T2 | Um fio declara o que implementa em `operations: { embeddings: {...}, ... }`. Cada entrada tem `buildRequest` e `parseResponse`. O `chat` continua com `buildRequest` e `parseStream`. | `parseStream` só recebe SSE. `parseResponse` recebe a resposta inteira: status, headers, JSON ou bytes. |
| T3 | **`decision` não vira valor novo de `Account.api`.** É uma operação do `openai-completions`, e `compat.decisionPath` diz o caminho: `../alpha/decisions` no OpenRouter, `systemone` na TypeSafe. | **Ajuste da visão**, que falava em "fio da OpenRouter e da TypeSafe". Corpo e resposta são iguais nos dois. Dois fios seriam duas cópias do mesmo código. |
| T4 | O que o fio implementa é uma pergunta, o que o modelo faz é outra. A lib confere as duas: `model.operations` e `operations` do fio. Provedor que não tem a rota responde 404 e vira `invalid_request`. | Mantém a regra "sem `if` por provedor". A tabela `ADAPTER_OPERATIONS` do Gateway segue no Gateway, para a validação do cadastro. |
| T5 | **Política de custo fica no cliente.** Sem custo, a lib devolve `usd: null`. "Nunca faturar zero" é regra do Gateway, que trata isso na T2.2. | Hoje o adapter lança erro em imagem e decisão do OpenRouter, mas aceita a TypeSafe sem custo. Quem sabe o que fazer é quem cobra. |
| T6 | Fica **no cliente**: retry, PCM→WAV, normalização de idioma, detecção do formato de áudio pelos bytes, `decidirPorChat`, criação e renovação do cache do Gemini. | Regra da visão: comportamento de cliente fica no cliente. A lib só classifica o erro. |
| T7 | Cobrança de fala usa `usage.input` = número de caracteres, e `cost.input` = US$ por milhão de caracteres. | É o que os dados migrados do Gateway já significam. Evita mudar `Cost` e migrar preço de novo. |

## 3. Infraestrutura (`client.js`, `types.js`)

**Cliente.** `createClient` passa a devolver também `embed`, `transcribe`, `speak`, `generateImage` e `decide`, os nomes que `METHODS_BY_OPERATION` já traz. Essa tabela passa a ser lida de verdade. Sem a operação no modelo ou no fio, o resultado é `unsupported`, antes do fetch.

**Pedido.** `buildRequest` pode devolver `FormData` em `body`. Nesse caso o cliente não serializa nem define `Content-Type`.

**Resposta.** `parseResponse(res, ctx)` recebe `{ status, headers, json(), bytes() }`. Status fora de 2xx é tratado antes, igual ao chat.

**Prazos.**
- Toda chamada aceita `timeouts` próprio, que vence o da conta. Os prazos reais variam muito: decisão em 1,5 s no Igris, imagem em 120 s.
- Na chamada única, o primeiro byte termina nos headers. O corpo é lido por um leitor que mantém o relógio de inatividade.
- Vale também para `chat`.

**Headers no chat.** `parseStream` passa a receber os headers da resposta em `ctx`. O Gateway lê o `X-Generation-Id` para diagnóstico.

**Erros.** Resposta 200 inválida (decisão sem `answers`, imagem sem `data` ou com base64 quebrado, `n` diferente do pedido) vira `upstream` com `retryOther: true`. Fora de stream, `emitted` é sempre `false`.

**Retorno das operações:**

| Método | Pedido | Resultado (mais `usage`, `cost`) |
|---|---|---|
| `embed` | `{ texts, dimensions? }` | `{ vectors }` |
| `transcribe` | `{ audio: Uint8Array, mime, filename?, language?, prompt? }` | `{ text, durationSeconds? }` |
| `speak` | `{ text, voice?, format?, instructions?, speed?, params? }` | `{ audio: Uint8Array, contentType }` |
| `generateImage` | `{ prompt, params? }` | `{ images: [{ base64, mediaType }] }` |
| `decide` | `{ state, questions, params? }` | `{ answers }` |

Todos aceitam `signal` e `timeouts`. `params` seguem a regra atual: entram por baixo dos campos de controle.

**Novos campos:**

| Tipo | Campo | Uso |
|---|---|---|
| `Compat` | `sttResponseFormat` | `verbose_json` no `whisper-1` e no Groq; `json` nos `gpt-4o-*-transcribe` (modelo sobrescreve a conta) |
| `Compat` | `ttsDefaultVoice`, `ttsDefaultFormat` | Sem valor, o campo não vai no corpo. É o caso do OpenRouter: o Gemini TTS só aceita `pcm` |
| `Compat` | `imagePath`, `imageResponseFormat` | `/images` no OpenRouter; `/images/generations` com `b64_json` na OpenAI |
| `Compat` | `decisionPath` | Ver T3. Sem valor, `decision` dá `unsupported` |
| `Compat` | `structuredOutput: 'response_json_schema'` | Gemini |
| `Transport` | `audio`/`video`/`file: 'inline_data'` | Gemini |
| `Cost` | `cacheStoragePerMTokHour` | Armazenamento do cache do Gemini. Somado fora das faixas, só no caminho da tabela. Substitui `gatewayCost.storagePerMTokHour` na T2.2 |
| `Usage` | `cacheStorageTokenHours` | Preenchido pelo **cliente**, que sabe o que o cache consumiu |

**Fala:**
- `contentType` vem do header do provedor quando é `audio/*`, com os parâmetros (`audio/pcm;rate=24000`). Sem isso, vem do formato pedido.
- O `X-Generation-Id`, quando vier, vai em `usage.raw`.

## 4. Operações em `openai-completions`

Equivalem aos adapters atuais do Gateway. O teste de diferença no fio do Gateway (`wire-differential.test.ts`) é a referência da T2.2.

- **Embeddings:** `POST {base}/embeddings`, `{ model, input, dimensions? }`. Reordena por `index`. `dimensions` só vai se o pedido trouxer (o Igris manda 768).
- **STT:** `POST {base}/audio/transcriptions`, multipart. A duração vem de `duration`, senão do maior `segments[].end`. Cobre whisper-1 (por segundo), `gpt-4o-*-transcribe` (por token) e Groq.
- **TTS:** `POST {base}/audio/speech`. `instructions` e `speed` só vão quando vierem.
- **Imagem:** `POST {base}{compat.imagePath}`.
- **Decisão:** URL resolvida de `compat.decisionPath` contra a base. Corpo `{ ...params, model, state, questions }`. Uso em `input_tokens`, `output_tokens`, `cost`.

`catalog/openrouter.js` passa a derivar `image-generation` de saída só imagem e `speech` de saída só áudio. Hoje tudo isso vira `chat`.

## 5. Fio `google-generative-ai`

Tem por base o adapter do Gateway, que já roda em produção, e corrige o que ele perde em silêncio.

- **URL:** `{base}/models/{id}:streamGenerateContent?alt=sse`, chave no header `x-goog-api-key`.
- **Corpo:** `contents`, `systemInstruction`, `tools` (`functionDeclarations`), `generationConfig` (`temperature`, `maxOutputTokens`, `responseMimeType` + `responseJsonSchema`).
- **Anexos:** imagem, áudio, vídeo e arquivo por `inlineData`. **Isso resolve o descarte de imagem em silêncio.** URL dá `unsupported`, porque o Gemini só aceita `fileUri` da Files API.
- **Tools:**
  - Resultado de tool sem chamada correspondente na conversa dá `invalid_request`. Hoje é descartado.
  - O id da chamada é sintético (`gemini-tc-{n}`), como hoje.
- **Stream:**
  - `part.thought` vira evento `reasoning`.
  - `finishReason`: `STOP` → `stop`, `MAX_TOKENS` → `length`, com tool call → `tool_calls`, `SAFETY`/`RECITATION` → `content_filter`.
  - Erro dentro do SSE vira `ProviderError`. Hoje é ignorado.
- **Uso:** o último `usageMetadata` vence. `input = promptTokenCount − cachedContentTokenCount`, `output = candidatesTokenCount + thoughtsTokenCount`, `cacheRead = cachedContentTokenCount`, `reasoning = thoughtsTokenCount`.
- **`cachedContent`:**
  - `ChatRequest.cachedContent` é só a referência.
  - Junto com `system` ou `tools` dá `invalid_request`, em vez de descartar, porque a API proíbe.
  - O reenvio sem cache continua no cliente.
  - A lib exporta `toGeminiContents(messages)`, de que o `google-cache.ts` precisa para o snapshot.

## 6. Contrato de chat

- **`tool_choice`:** `'auto' | 'none' | 'required' | { name }`, nos quatro fios.
- **`stop`:** lista de textos, nos quatro fios.
- **`reasoning`:** além de `effort`, o pedido aceita `{ maxTokens, exclude }`, para o formato objeto do OpenRouter. Os perfis do Gateway já declaram isso.
- Esses três destravam o que a API nova do Gateway recusa hoje (`tool_choice` forçado, `stop`, `reasoning.max_tokens`).
- **`isError`** no resultado de tool: vira `is_error` na Anthropic. Nos outros fios vai no texto, porque não há campo.
- **Raciocínio assinado:**
  - O evento `reasoning` ganha `signature`, quando houver.
  - `Part` ganha `{ type: 'reasoning', text, signature }`, devolvida no fio que a aceita.
  - O mesmo vale para `thoughtSignature` do Gemini em tool call, levado como dado opaco em `toolCalls[].providerData`.
  - **A verificar no smoke:** um ciclo completo de tool, com pensamento ligado, na Anthropic e no Gemini. É o que prova se isso é necessário nos modelos atuais.

## 7. Fio `openai-responses`

**Só o Igris usa, na E4.** Por isso é a última fase: a T2.2 não depende dele.

- `POST {base}/responses`. Sistema como item `input` de papel `system`, com `type: 'message'` em todo item: é o formato testado no Igris, e o llama.cpp recusa item sem tipo.
- Tools no formato plano, `function_call` e `function_call_output`. Saída com `text.format`, `reasoning: { effort }`, `max_output_tokens`.
- **Stream e tools juntos**, que o Igris hoje não faz: `response.output_text.delta`, os eventos de `function_call`, `response.reasoning_summary_text.delta`, `response.completed`, `response.incomplete`, `response.failed`, `error`.
- Anexos: `input_image` e `input_file`. Áudio e vídeo dão `unsupported`.
- `store` só vai com `compat.supportsStore`, como hoje.

## 8. Fixtures e testes

**`record-fixture.mjs` aprende:**
- a operação (`--operation`);
- resposta binária, gravada como `<nome>.bin` mais `<nome>.meta.json` com status e headers selecionados;
- multipart, descrito em `.request.json` pelos campos e pelo tamanho do arquivo;
- a limpar também `x-goog-api-key`, chaves `AIza…` e `Bearer` de qualquer formato.

`.gitattributes` marca `test/fixtures/**/*.bin` como binário. Áudio gravado fica pequeno, abaixo de 20 KB.

**Regravar com provedores reais** os casos principais de chat (hoje escritos à mão) e gravar cada operação nova. Como no núcleo, os testes rodam offline.

**Smoke** passa a cobrir, com a chave do ambiente e pulando provedor sem chave:

| Provedor | Casos |
|---|---|
| OpenRouter | chat, TTS, imagem, decisão |
| OpenAI | chat, embeddings, STT, TTS |
| Anthropic | chat |
| Google | chat, imagem no chat, tools, `cachedContent` |
| Groq | STT |
| TypeSafe | decisão |

## 9. Ordem de execução

| Fase | Conteúdo | Destrava |
|---|---|---|
| 1 | Infraestrutura da §3 e o gravador | tudo |
| 2 | Operações em `openai-completions` e catálogo | T2.2 |
| 3 | Fio Google com `cachedContent` | T2.2 |
| 4 | Contrato de chat (§6) | T2.2 e API nova do Gateway |
| 5 | Fio `openai-responses` | E4 |

Tag `v0.2.0` ao fim das cinco. Se a T2.2 quiser começar antes da fase 5, sai uma `v0.2.0-rc` depois da fase 4.

## 10. Fora desta entrega

| Item | Para onde vai |
|---|---|
| Saída multimodal no chat (`modalities`, `message.images`, `message.audio`), que as capacidades do Igris usam | Antes da E4, numa entrega da lib própria. O Gateway não usa |
| Ollama nativo (`/api/chat`, `/api/embed`). Não cabe nos quatro fios | Decidir na E4: manter no Igris ou usar a `/v1` compatível |
| Marca de cache em `tools` e imagem | Quando um planejador pedir. Hoje ninguém usa |
| `effort` com `reasoningFormat: 'none'`: a lib ignora, o Igris recusa | E4 |
| Upload por Files API, publicação no npm | Sem data |

## 11. Critério de pronto

- [ ] `npm test` e `npm run typecheck` verdes, offline.
- [ ] `types/` regenerado.
- [ ] Fixtures reais gravadas para cada operação e os casos principais de chat, sem chave em nenhum arquivo.
- [ ] Smoke rodado com chaves reais, inclusive o ciclo de tool com pensamento.
- [ ] README e CHANGELOG atualizados.
- [ ] Tag `v0.2.0` publicada.
