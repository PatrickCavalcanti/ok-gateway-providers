# ok-gateway-providers

Fala com provedores de IA a partir de três entradas: uma **conta**, um **modelo** e um
**pedido**. Devolve eventos em stream, uso normalizado, custo em US$ e erro tipado.

- Node 20 ou mais novo, ESM, **zero dependência de runtime** (usa o `fetch` nativo).
- **Não guarda nada, não roteia e não repete chamadas.** Retry, fallback, armazenamento e
  planejamento de cache são do cliente. A lib dá o que ele precisa para decidir:
  `retryOther` e `emitted` no erro.
- Fios: `openai-completions` (OpenAI em estilo chat, OpenRouter, Groq, Ollama `/v1`,
  Inception, DeepSeek, llama.cpp, Igris Gateway), `openai-responses`, `anthropic-messages` e
  `google-generative-ai`.
- Operações: `chat`, com tools, saída estruturada, raciocínio e anexos; embeddings,
  transcrição, fala, geração de imagem e decisão.

## Instalar

Pela URL do tarball da tag (funciona sem git na máquina, e no pnpm):

```json
"dependencies": {
  "ok-gateway-providers": "https://github.com/PatrickCavalcanti/ok-gateway-providers/archive/refs/tags/v0.2.0.tar.gz"
}
```

## Uso

```js
import { createClient, createCreditConverter } from 'ok-gateway-providers';

const account = {
  id: 'openrouter-principal',
  provider: 'openrouter',
  api: 'openai-completions',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,          // ou uma função que devolve a chave na hora
  compat: { usageInStream: true, providerRouting: true, headers: { 'X-Title': 'Meu app' } },
  timeouts: { firstByteMs: 60_000, idleMs: 120_000, totalMs: 600_000 },
};

const model = {
  id: 'openai/gpt-5.4-mini',
  operations: ['chat'],
  input: ['text', 'image'],
  output: ['text'],
  cost: { input: 0.75, output: 4.5, cacheRead: 0.075 }, // US$ por milhão de tokens
  compat: { structuredOutput: 'response_format', reasoningFormat: 'reasoning_object' },
};

const run = createClient({ account, model }).chat({
  system: 'Você é breve.',
  messages: [{ role: 'user', content: 'Diga oi.' }],
  effort: 'low',
});

for await (const ev of run) {
  if (ev.type === 'text') process.stdout.write(ev.text);
  if (ev.type === 'tool_call') console.log(ev.name, JSON.parse(ev.arguments));
}

const { usage, cost, finishReason } = await run.result;
// usage: { input, output, cacheRead, cacheWrite, cacheWrite1h, reasoning?, raw }
// cost:  { usd, source: 'provider' | 'table' | 'none' }

const credits = createCreditConverter({ creditsPerUsd: 5500, rounding: 'round', decimals: 6 });
credits.toCredits(cost.usd); // null continua null
```

### Pedido

| Campo | O que é |
|---|---|
| `system` | string, ou blocos `{ text, cache?: { ttl: '5m' \| '1h' } }[]` |
| `messages` | `{ role: 'user' \| 'assistant' \| 'tool', content, toolCalls?, toolCallId? }[]` |
| `tools` | `{ name, description, parameters }[]` (JSON Schema) |
| `responseSchema` | `{ name?, schema, strict? }` |
| `effort` | `'none' \| 'low' \| 'medium' \| 'high' \| 'xhigh'` |
| `maxTokens`, `temperature` | — |
| `params` | passthrough para o corpo (não sobrescreve `model`, `messages`, `stream`, `tools`…) |
| `signal` | `AbortSignal` do chamador |

`content` é string ou partes: `{ type: 'text', text, cache? }`,
`{ type: 'image', data | url, mime }`, `{ type: 'audio', data, format }`,
`{ type: 'video', data | url, mime }`, `{ type: 'file', data | url, mime, name?, cache? }`
(PDF, texto e outros documentos).

### Eventos

| Evento | Campos |
|---|---|
| `text` | `text` (delta) |
| `reasoning` | `text` (delta), quando o fio expõe |
| `tool_call` | `id`, `name`, `arguments` (JSON **completo**) |
| `end` | `finishReason`, `usage`, `cost` |

Sair do `for await` (ou `run.abort()`) cancela o pedido.

### Compat

Cada campo substitui um `if` por provedor. A conta traz o padrão e o modelo sobrescreve
campo a campo (`resolveCompat`). A conta genérica `openai-completions` nasce
conservadora: `max_tokens`, sem `developer`, sem `store`, sem saída estruturada, sem uso
no stream e sem marcador de cache. Ligue o que o endpoint suporta.

| Campo | Valores |
|---|---|
| `maxTokensField` | `max_tokens` · `max_completion_tokens` · `max_output_tokens` |
| `supportsDeveloperRole`, `supportsStore`, `supportsTemperature` | bool |
| `reasoningFormat` | `reasoning_effort` · `reasoning_object` · `anthropic_thinking` · `none` |
| `thinkingByDefault` | bool (Anthropic) |
| `structuredOutput` | `response_format` · `top_level_json_schema` · `output_config` · `none` |
| `usageInStream` | bool (`stream_options.include_usage`) |
| `providerRouting` | bool: aceita o objeto `provider` do OpenRouter em `params` |
| `cacheMarker` | `cache_control` · `prompt_cache_breakpoint` · `none` |
| `headers` | objeto, com merge |

### Anexos

`model.transport` diz como cada mídia viaja: `image` (`['data-url', 'url']` por padrão),
`audio` (`input_audio` ou `null`), `video` (`input_video`, `video_url` ou `null`),
`file` (`['data-url']` por padrão; `'url'` quando o endpoint aceita).

Arquivo no `openai-completions` vai como `{ type: 'file', file: { filename, file_data } }`
(OpenAI, OpenRouter, Gateway). No `anthropic-messages` vira bloco `document`: a Messages
API lê **PDF** (base64 ou URL) e **texto puro**; outro tipo (docx, planilha…) dá
`unsupported` — converter é papel do cliente. Mídia
que o modelo não declara em `input`, ou que o transporte não suporta, dá erro
`unsupported` **antes** do fetch. Nada é descartado em silêncio. Baixar uma URL é papel
do cliente.

### Erros

`ProviderError { type, retryOther, emitted, status?, provider, model, body? }`.

| Situação | `type` | `retryOther` |
|---|---|---|
| 401, 403 | `auth` | true |
| 429 | `rate_limit` | true |
| 400, 404, 422 do provedor | `invalid_request` | true (outro modelo pode aceitar) |
| pedido malformado (mensagem sem `content`, `toolCalls` inválido…) | `invalid_request` | **false** |
| falha ao obter a chave (`apiKey` função) | `auth` | true |
| 5xx, rede, stream cortado, tool call cortada | `upstream` | true |
| prazo (primeiro byte, inatividade, total) | `timeout` | true |
| mídia ou parâmetro sem suporte | `unsupported` | true |
| `signal` do chamador | `aborted` | false |

Regra de fallback do consumidor: passe ao próximo alvo só com `retryOther && !emitted`.

### Custo

`computeCost(model, usage, reportedUsd?)`: o custo informado pelo provedor vence
(`provider`); sem ele, a tabela do modelo (`table`), com cache lido e gravado (5 min e
1 h) à parte, faixas de contexto longo (`cost.tiers`) e áudio por segundo com mínimo;
sem tabela, `usd: null` (`none`) — nunca um valor inventado. Cache sem preço declarado
sai ao preço de input.

Quando o provedor não declara uso nenhum (conta sem `usageInStream`, stream que caiu antes
do chunk de uso), `usage.missing` vem `true` e o custo pela tabela é `{ usd: null, source:
'none' }` — **não** US$ 0. Quem cobra precisa tratar esse caso.

`max_tokens` só vai no corpo quando o pedido traz `maxTokens` (a Anthropic exige o campo:
1024, ou 16000 quando o raciocínio vai rodar).

### Catálogo

`parseOpenRouterModels(json)` transforma o `/api/v1/models` do OpenRouter (ou do Igris
Gateway, que fala o mesmo formato) em `Model[]`, com modalidades, operações, preço por
milhão e o compat que o `supported_parameters` declara.

### Vocabulário

`OPERATIONS`, `INPUT_MODALITIES`, `OUTPUT_MODALITIES`, `formatShape`, `parseShape`,
`shapeOf`, `requestKey`, `isEligible`, `ineligibilityReason` — o pedido é operação +
forma (`chat text+image->text`).

## Desenvolver

```bash
npm test            # node --test, offline (fetch falso + fixtures gravadas)
npm run typecheck   # tsc --noEmit sobre o JSDoc
npm run build:types # gera types/ (entra no commit de cada versão)
```

`scripts/record-fixture.mjs` grava uma fixture a partir de uma chamada real (a chave vem
do ambiente e é removida do que vai para o disco). `scripts/smoke.mjs` confere
OpenRouter e Anthropic de verdade — texto, tool call e imagem — e roda à mão antes de
cada tag.

## Licença

MIT.

## Outras operações

São chamada única: devolvem uma `Promise`, sem eventos. Todas resolvem com `usage` e `cost`, e
aceitam `signal` e `timeouts`, que vencem os da conta. Modelo sem a operação em `operations`, ou
fio que não a implementa, dá `unsupported` antes do fetch.

```js
const client = createClient({ account, model });

const { vectors } = await client.embed({ texts: ['olá'], dimensions: 768 });
const { text, durationSeconds } = await client.transcribe({ audio: bytes, mime: 'audio/mpeg', language: 'pt' });
const { audio, contentType } = await client.speak({ text: 'Olá', voice: 'onyx', format: 'mp3' });
const { images } = await client.generateImage({ prompt: 'um gato', params: { n: 1 } });
const { answers } = await client.decide({ state: {}, questions: {} });
```

- Na fala, `usage.input` é o número de caracteres, e `cost.input` é US$ por milhão de caracteres.
- Sem custo informado e sem tabela, `cost.usd` é `null`. A lib não inventa valor, e "nunca faturar
  zero" é regra de quem cobra.
- A lib não converte PCM em WAV, não normaliza idioma e não detecta o formato do áudio pelos bytes.

## `compat` por provedor

| Provedor | `api` | `compat` da conta |
|---|---|---|
| OpenRouter | `openai-completions` | `{ usageInStream: true, providerRouting: true, reasoningFormat: 'reasoning_object', imagePath: '/images', imageResponseFormat: null, decisionPath: '../alpha/decisions' }` |
| OpenAI, estilo chat | `openai-completions` | `{ usageInStream: true, maxTokensField: 'max_completion_tokens', reasoningFormat: 'reasoning_effort', structuredOutput: 'response_format', ttsDefaultVoice: 'onyx', ttsDefaultFormat: 'mp3' }` |
| OpenAI, Responses | `openai-responses` | `{ structuredOutput: 'text_format', reasoningFormat: 'reasoning_object' }` |
| Groq | `openai-completions` | `{ sttResponseFormat: 'verbose_json' }` |
| TypeSafe | `openai-completions` | `{ decisionPath: 'systemone' }` |
| Anthropic | `anthropic-messages` | padrão. No modelo da geração 5: `{ thinkingByDefault: true, supportsTemperature: false }` |
| Google | `google-generative-ai` | padrão |

No `whisper-1`, o modelo sobrescreve com `{ sttResponseFormat: 'verbose_json' }`.

`effort` e `reasoning.maxTokens` não vão juntos: o OpenRouter recusa, e a lib dá `invalid_request`.
O que o pedido traz explícito (`toolChoice`, `stop`, `maxTokens`, `temperature`, `responseSchema`)
vence `params`.

## Devolver o histórico

Para continuar uma conversa com tools, devolva o raciocínio assinado e os `providerData` que
vieram. `signature` fecha um bloco de raciocínio. Cada fio ignora ou aproveita o que recebe, então
trocar de provedor no meio da conversa não quebra o corpo.

```js
const content = [];
const toolCalls = [];
let thinking = null;

for await (const ev of run) {
  if (ev.type === 'reasoning') {
    if (ev.redacted) content.push({ type: 'reasoning', text: '', redacted: ev.redacted });
    else {
      thinking ??= { type: 'reasoning', text: '' };
      thinking.text += ev.text ?? '';
      if (ev.signature) { content.push({ ...thinking, signature: ev.signature }); thinking = null; }
    }
  } else if (ev.type === 'text') content.push({ type: 'text', text: ev.text });
  else if (ev.type === 'tool_call') toolCalls.push({ id: ev.id, name: ev.name, arguments: ev.arguments, providerData: ev.providerData });
}

messages.push({ role: 'assistant', content, toolCalls });
```

## Catálogo

`parseOpenRouterModels` lê o `/models` do OpenRouter. **Peça `?output_modalities=all`**: sem isso a
API só lista modelos de saída texto, e os de fala, transcrição, decisão e imagem não aparecem.
Saída que o vocabulário não conhece (vídeo, rerank) fica com `operations: []`.
