# Pendências — T1.1 núcleo (2026-10-31)

| Área | Pendência | Para |
|---|---|---|
| entrega | ~~Rodar o smoke e criar a tag~~ — feito em 2026-11-03: OpenRouter (`openai/gpt-5.4-mini`) e Anthropic (`claude-haiku-5-5`) passaram em texto, tool call, imagem, PDF e saída estruturada; tag `v0.1.0` | feito |
| repositório | ~~Branch padrão `claude/awesome-rubin-mmewif`~~ — feito em 2026-11-03: padrão `main`. A branch antiga continua no GitHub, igual a um commit antes de `main`; apagar quando quiser | dono |
| fixtures | As fixtures foram escritas à mão no formato real; regravar as principais com `scripts/record-fixture.mjs` contra provedores de verdade | T1.2 |
| openai-completions | `x_groq.usage` lido sem evidência local (formato público do Groq); confirmar no smoke | smoke |
| openai-completions | `prompt_cache_breakpoint` em `user` e `tool` (o Gateway só usou no system); confirmar no tráfego real | T2.2 |
| anthropic-messages | Blocos `thinking` com `signature` não fazem ida e volta (thinking + tool use exige devolvê-los); Igris e Gateway também não fazem hoje | T1.2 |
| anthropic-messages | Limite de 4 breakpoints de cache por pedido não é contado pela lib; só uma marca por `tool_result` | T2.2 |
| contrato | Sem `tool_choice`, `is_error` no `tool_result`, nem marca de cache em `tools` e imagem; só via `params` | T1.2 |
| custo | `Cost` não tem armazenamento de cache por hora (Gemini, `usdPerMTokStoragePerHour` do Gateway); entra com `cachedContent` | T1.2 |
| custo | A migração de preços do Gateway precisa escrever explícitos os padrões de cache (10 %, 125 %, 200 %) e decidir o que cobrar sem preço (`FALLBACK_COST` → aqui é `usd: null`) | T2.1 |
| custo | `usage.missing` precisa de tratamento no Gateway (não cobrar zero em silêncio) | T2.2 |
| anexos | Arquivo por URL no OpenRouter (`file_data` com URL) não confirmado: o padrão é só data-url; ligar `transport.file: ['data-url','url']` depois de provar no smoke | smoke |
| compat | `effort` com `reasoningFormat: 'none'` é ignorado sem erro; o Igris (D6) recusa — decidir se vira `unsupported` | E4 |
