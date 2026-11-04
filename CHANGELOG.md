# Changelog

Versão semântica; `0.x` enquanto a API se acomoda — cada consumidor fixa a tag exata.

## 0.2.0 — 2026-11-04

- Operações de chamada única: `embed`, `transcribe`, `speak`, `generateImage` e `decide`.
- Fios `google-generative-ai` (com `cachedContent`, anexos por `inlineData` e `toGeminiContents`
  exportada) e `openai-responses`.
- Chat: `toolChoice`, `stop`, `reasoning.maxTokens` e `exclude`, `isError`, `toolName`, raciocínio
  assinado e `providerData` em ida e volta. `timeouts` por pedido.
- `Cost.cacheStoragePerMTokHour` e `Usage.cacheStorageTokenHours`. Vários campos novos em `Compat`.
- Fixtures gravadas de provedores reais, exceto Gemini.

**O que muda para quem já usa:**

- `parseOpenRouterModels`: saída só imagem agora é `image-generation`, e não `chat`. As saídas
  `speech`, `transcription` e `decisions` viram a operação certa. Vídeo e rerank ficam com
  `operations: []`.
- `toolChoice`, `stop`, `maxTokens` e `temperature` explícitos passam a vencer `params`.
- Evento `reasoning` pode vir com `text: ''` e `signature`.
- `effort` junto de `reasoning.maxTokens` dá `invalid_request`.
- Áudio e vídeo em data-url passam sem `format`/`mime`, e o prefixo sai do corpo enviado.

**O fio Gemini não foi provado contra a API real:** a conta usada no smoke estava sem crédito (402).

## 0.1.0 — 2026-11-03

Primeira versão: o núcleo (T1.1).

- Vocabulário de operação e forma.
- Fios `openai-completions` e `anthropic-messages`, operação `chat`: texto, tools,
  saída estruturada, raciocínio, anexos de imagem, áudio, vídeo e arquivo (PDF, texto…).
- Compat declarado (conta ← modelo).
- Uso normalizado, custo em US$ (provedor > tabela > nenhum) e conversor de créditos.
- Erro tipado com `retryOther` e `emitted`; prazos de primeiro byte, inatividade e total.
- Leitor do catálogo no formato OpenRouter.
