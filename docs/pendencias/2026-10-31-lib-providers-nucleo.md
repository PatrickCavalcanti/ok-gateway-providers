# Pendências — T1.1 núcleo (2026-10-31)

| Área | Pendência | Para |
|---|---|---|
| entrega | Rodar `scripts/smoke.mjs` com `OPENROUTER_API_KEY` e `ANTHROPIC_API_KEY` (texto, tool call, imagem) e só então criar a tag `v0.1.0` | dono |
| repositório | O branch padrão no GitHub nasceu como `claude/awesome-rubin-mmewif` (primeiro push); criar `main` a partir dele e trocar o padrão | dono |
| fixtures | As fixtures foram escritas à mão no formato real; regravar as principais com `scripts/record-fixture.mjs` contra provedores de verdade | T1.2 |
| openai-completions | `x_groq.usage` lido sem evidência local (formato público do Groq); confirmar no smoke | smoke |
| openai-completions | `prompt_cache_breakpoint` em `user` e `tool` (o Gateway só usou no system); confirmar no tráfego real | T2.2 |
| anthropic-messages | Blocos `thinking` com `signature` não fazem ida e volta (thinking + tool use exige devolvê-los); Igris e Gateway também não fazem hoje | T1.2 |
| anthropic-messages | Limite de 4 breakpoints de cache por pedido não é contado pela lib; só uma marca por `tool_result` | T2.2 |
| contrato | Sem `tool_choice`, `is_error` no `tool_result`, nem marca de cache em `tools` e imagem; só via `params` | T1.2 |
| custo | `Cost` não tem armazenamento de cache por hora (Gemini, `usdPerMTokStoragePerHour` do Gateway); entra com `cachedContent` | T1.2 |
| custo | A migração de preços do Gateway precisa escrever explícitos os padrões de cache (10 %, 125 %, 200 %) e decidir o que cobrar sem preço (`FALLBACK_COST` → aqui é `usd: null`) | T2.1 |
| custo | `usage.missing` precisa de tratamento no Gateway (não cobrar zero em silêncio) | T2.2 |
| compat | `effort` com `reasoningFormat: 'none'` é ignorado sem erro; o Igris (D6) recusa — decidir se vira `unsupported` | E4 |
