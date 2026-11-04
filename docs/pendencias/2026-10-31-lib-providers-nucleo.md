# Pendências — T1.1 núcleo (2026-10-31)

| Área | Pendência | Para |
|---|---|---|
| entrega | ~~Rodar o smoke e criar a tag~~ — feito em 2026-11-03: OpenRouter (`openai/gpt-5.4-mini`) e Anthropic (`claude-haiku-5-5`) passaram em texto, tool call, imagem, PDF e saída estruturada; tag `v0.1.0` | feito |
| repositório | ~~Branch padrão `claude/awesome-rubin-mmewif`~~ — feito em 2026-11-03: padrão `main`. A branch antiga continua no GitHub, igual a um commit antes de `main`; apagar quando quiser | dono |
| fixtures | ~~Fixtures à mão~~ — feito em 2026-11-04 para OpenRouter, OpenAI, Anthropic, Groq e TypeSafe (`real-*.sse`, `test/fixtures/operations`, `test/fixtures/openai-responses`). Falta o Gemini, na linha abaixo | feito |
| openai-completions | `x_groq.usage` lido sem evidência local (formato público do Groq); confirmar no smoke | smoke |
| openai-completions | `prompt_cache_breakpoint` em `user` e `tool` (o Gateway só usou no system); confirmar no tráfego real | T2.2 |
| anthropic-messages | ~~Blocos `thinking` sem ida e volta~~ — feito na T1.2 | feito |
| anthropic-messages | Limite de 4 breakpoints de cache por pedido não é contado pela lib; só uma marca por `tool_result` | T2.2 |
| contrato | ~~`tool_choice` e `is_error`~~ — feito na T1.2. Marca de cache em `tools` e imagem fica até um planejador pedir | feito |
| custo | ~~Armazenamento de cache por hora~~ — feito na T1.2 (`cacheStoragePerMTokHour`). Na T2.2 o `gatewayCost.storagePerMTokHour` migra para ele | T2.2 |
| custo | A migração de preços do Gateway precisa escrever explícitos os padrões de cache (10 %, 125 %, 200 %) e decidir o que cobrar sem preço (`FALLBACK_COST` → aqui é `usd: null`) | T2.1 |
| custo | `usage.missing` precisa de tratamento no Gateway (não cobrar zero em silêncio) | T2.2 |
| anexos | Arquivo por URL no OpenRouter (`file_data` com URL) não confirmado: o padrão é só data-url; ligar `transport.file: ['data-url','url']` depois de provar no smoke | smoke |
| compat | `effort` com `reasoningFormat: 'none'` é ignorado sem erro; o Igris (D6) recusa — decidir se vira `unsupported` | E4 |
| catálogo | `/api/v1/models` sem parâmetro só lista modelo de saída texto (454 em 2026-11-04). Fala, transcrição, decisão e imagem só vêm com `?output_modalities=all` (696). Quem busca o catálogo precisa pedir assim; o leitor já entende as saídas | T2.2 |
| fala | No OpenRouter, o TTS do Gemini cobra por token de áudio gerado, e a resposta binária não traz uso nem custo. A lib mede caracteres (T7), como o Gateway hoje. Estimativa da revisão: subcobrança de cerca de 30× nesse modelo. Só o `X-Generation-Id` permite reconciliar | T2.2 |
| fixtures | **Gemini sem nenhuma gravação real.** A conta usada está sem crédito (HTTP 402). Falta rodar `scripts/smoke.mjs` e `scripts/smoke-cycle.mjs` com crédito e regravar `test/fixtures/google-generative-ai/{text,thought,tool-call}.sse`. O que só a API prova: `role: 'function'` no resultado de tool, `thoughtSignature` obrigatória ou não, `functionResponse` em lote, `candidatesTokenCount` sem o pensamento (afeta preço), `audio/${format}` | dono + T2.2 |
| anthropic-messages | Medido em 2026-11-04: devolver `thinking` assinado funciona, e omitir também. `tool_choice` `any` ou `tool` com pensamento ligado dá 400 no Sonnet 5.5. A lib não bloqueia, e o erro volta com `retryOther: true` | T2.2 |
| chat | Saída multimodal no chat (`modalities`, `message.images`, `message.audio`): as capacidades do Igris usam, e a lib não tem. Entrega própria antes da E4 | E4 |
| openai-responses | Formatos não provados em gravação: `input_file`, duas `function_call` em paralelo, corte por limite em tool call, recusa. `arguments` de tool call precisa ser string: o Igris guarda objeto, e o adaptador da E4 converte | E4 |
| fio Google | `gemini-tc-{n}` recomeça a cada resposta: num fallback para a Anthropic, saem dois `tool_use` com o mesmo id, e a API pode recusar. A spec decidiu manter como hoje; medir | T2.2 |
| fio Google | `parameters` com JSON Schema cru pode dar 400 (`$schema`, `additionalProperties` com propriedades): é o maior risco do fio quando o smoke rodar. Alternativa: `parametersJsonSchema` | smoke |
| T2.2 · Gateway | `coverage` do cache do Gemini conta `contents`, e a lib recebe `messages` e agrupa resultados de tool. Um `messages.slice(-1)` ingênuo perde resultado de tool. Fatiar por grupo e usar `toolName` no sufixo | T2.2 |
| T2.2 · Gateway | `ToolCallSpec` não tem `providerData`: guardar e devolver `thoughtSignature` | T2.2 |
| T2.2 · Gateway | `effectiveReasoning` junta `effort` do chamador com `maxTokens` do perfil. A lib dá `invalid_request` com `retryOther: false`, e a cadeia pararia, onde hoje avança: resolver antes de chamar | T2.2 |
| T2.2 · Gateway | `validateCompat` recusa `null` (`validate.ts:161-165`), e `imageResponseFormat: null` é necessário. `ModelDoc` não tem `transport`, necessário para vídeo no OpenRouter | T2.2 |
| T2.2 · Gateway | `thinksByDefault` vira `compat.thinkingByDefault` e `supportsTemperature: false` nos modelos. Armazenamento de cache sai de um lugar só (`gatewayCost` ou `cost`), senão cobra em dobro. `usage.missing` com `FALLBACK_COST` hoje dá fatura zero (`pricing.ts:216-221`) | T2.2 |
| Ariadne | Consome o `chat` da lib, fixada em `d898834` (`gatewayProvider.ts`), e compara `err.message.includes('tool call cortada')`. Contrato frágil: o texto foi mantido, e vale avisar ao subir a versão | Ariadne |
