# Changelog

Versão semântica; `0.x` enquanto a API se acomoda — cada consumidor fixa a tag exata.

## 0.1.0 — ainda sem tag

Primeira versão: o núcleo (T1.1).

- Vocabulário de operação e forma.
- Fios `openai-completions` e `anthropic-messages`, operação `chat`: texto, tools,
  saída estruturada, raciocínio, anexos de imagem, áudio, vídeo e arquivo (PDF, texto…).
- Compat declarado (conta ← modelo).
- Uso normalizado, custo em US$ (provedor > tabela > nenhum) e conversor de créditos.
- Erro tipado com `retryOther` e `emitted`; prazos de primeiro byte, inatividade e total.
- Leitor do catálogo no formato OpenRouter.
