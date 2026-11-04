# ok-gateway-providers

Fala com provedores de IA a partir de três entradas: uma **conta**, um **modelo** e um
**pedido**. Devolve eventos em stream, uso normalizado, custo em US$ e erro tipado.

- Node 20 ou mais novo, ESM, **zero dependência de runtime** (usa o `fetch` nativo).
- **Não guarda nada, não roteia e não repete chamadas.** Retry, fallback, armazenamento e
  planejamento de cache são do cliente. A lib dá o que ele precisa para decidir:
  `retryOther` e `emitted` no erro.
- Fios: `openai-completions` (OpenAI em estilo chat, OpenRouter, Groq, Ollama `/v1`,
  Inception, DeepSeek, llama.cpp, Igris Gateway), `anthropic-messages` e
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

const { usage, cost, finishReason, generationId } = await run.result;
// usage: { input, output, cacheRead, cacheWrite, cacheWrite1h, reasoning?, raw }
// cost:  { usd, source: 'provider' | 'table' | 'none' }
// generationId: o header x-generation-id do provedor, quando vier (diagnóstico)

const credits = createCreditConverter({ creditsPerUsd: 5500, rounding: 'round', decimals: 6 });
credits.toCredits(cost.usd); // null continua null
```

### Pedido

| Campo | O que é |
|---|---|
| `system` | string, ou blocos `{ text, cache?: { ttl: '5m' \| '1h' } }[]` |
| `messages` | `{ role: 'user' \| 'assistant' \| 'tool', content, toolCalls?, toolCallId?, toolName?, isError? }[]` |
| `tools` | `{ name, description, parameters }[]` (JSON Schema) |
| `toolChoice` | `'auto' \| 'none' \| 'required' \| { name }`. Exige `tools`; sem elas é `invalid_request` |
| `responseSchema` | `{ name?, schema, strict? }` |
| `stop` | `string[]`: textos que encerram a geração. A Responses API não tem; lá dá `unsupported` |
| `effort` | `'none' \| 'low' \| 'medium' \| 'high' \| 'xhigh'` |
| `reasoning` | `{ maxTokens?, exclude? }`, além do `effort`. Só o `reasoningFormat: 'reasoning_object'` do `openai-completions` aceita; nos outros é `unsupported`. `maxTokens` não vai junto com `effort` |
| `maxTokens`, `temperature` | — |
| `cachedContent` | `cachedContents/…` do Gemini. Os outros fios dão `unsupported`; junto de `system` ou `tools` é `invalid_request` |
| `params` | passthrough para o corpo (não sobrescreve `model`, `messages`, `stream`, `tools`…) |
| `signal` | `AbortSignal` do chamador |
| `timeouts` | `{ firstByteMs?, idleMs?, totalMs? }`; vence o `timeouts` da conta |

`params` é padrão e porta de escape: entra primeiro no corpo. Tudo que o pedido traz explícito
(`toolChoice`, `stop`, `maxTokens`, `temperature`, `responseSchema`, `effort`, `reasoning`) vence,
e objeto do corpo (`output_config`, `thinking`, `generationConfig`, `reasoning`, `text`) funde
campo a campo com o explícito vencendo.

`content` é string ou partes: `{ type: 'text', text, cache? }`,
`{ type: 'image', data | url, mime, cache? }` (a marca só tem efeito na Anthropic), `{ type: 'audio', data, format }`,
`{ type: 'video', data | url, mime }`, `{ type: 'file', data | url, mime, name?, cache? }`
(PDF, texto e outros documentos).

### Eventos

| Evento | Campos |
|---|---|
| `text` | `text` (delta) |
| `reasoning` | `text` (delta), quando o fio expõe. Na Anthropic, `signature` fecha o bloco (o evento vem com `text: ''`) e `redacted` traz o bloco cifrado |
| `tool_call` | `id`, `name`, `arguments` (JSON **completo**), `providerData?` (dado opaco do provedor; no Gemini, a `thoughtSignature`) |
| `end` | `finishReason`, `usage`, `cost`, `generationId?` |

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
| `structuredOutput` | `response_format` · `top_level_json_schema` (llama.cpp) · `output_config` (Anthropic) · `response_json_schema` (Gemini) |
| `usageInStream` | bool (`stream_options.include_usage`) |
| `providerRouting` | bool: aceita o objeto `provider` do OpenRouter em `params` |
| `cacheMarker` | `cache_control` · `prompt_cache_breakpoint` · `none` |
| `sttResponseFormat` | `json` · `verbose_json` (transcrição) |
| `ttsDefaultVoice`, `ttsDefaultFormat` | texto ou `null` (fala); `null` não manda o campo |
| `imagePath`, `imageResponseFormat` | caminho da imagem (`/images/generations`) e `response_format` (`b64_json`, ou `null`) |
| `decisionPath` | caminho da decisão, resolvido contra a `baseUrl`; sem ele, `decision` dá `unsupported` |
| `headers` | objeto, com merge |

### Anexos

`model.transport` diz como cada mídia viaja: `image` (`['data-url', 'url']` por padrão),
`audio` (`input_audio`, `inline_data` ou `null`), `video` (`input_video`, `video_url`,
`inline_data` ou `null`), `file` (`['data-url']` por padrão; `'url'` quando o endpoint aceita).

Arquivo no `openai-completions` vai como `{ type: 'file', file: { filename, file_data } }`
(OpenAI, OpenRouter, Gateway). No `anthropic-messages` vira bloco `document`: a Messages
API lê **PDF** (base64 ou URL) e **texto puro**; outro tipo (docx, planilha…) dá
`unsupported` — converter é papel do cliente. No `google-generative-ai` imagem, áudio, vídeo e
arquivo vão por `inline_data` (base64); URL dá `unsupported`, porque o Gemini só aceita
`fileUri` da Files API. Mídia que o modelo não declara em `input`, ou que o transporte não
suporta, dá erro `unsupported` **antes** do fetch. Nada é descartado em silêncio. Baixar uma
URL é papel do cliente.

### Erros

`ProviderError { type, retryOther, emitted, status?, provider, model, body?, code?, errorType?,
providerCode?, providerName?, generationId? }`.

| Situação | `type` | `retryOther` |
|---|---|---|
| 401, 403 | `auth` | true |
| 429 | `rate_limit` | true |
| 400, 404, 422 do provedor | `invalid_request` | true (outro modelo pode aceitar) |
| pedido malformado (mensagem sem `content`, `toolCalls` inválido, `signal` que não é AbortSignal, corpo que não vira JSON…) | `invalid_request` | **false** |
| falha ao obter a chave (`apiKey` função) | `auth` | true |
| 5xx, rede, stream cortado, tool call cortada | `upstream` | true |
| prazo (primeiro byte, inatividade, total) | `timeout` | true |
| mídia ou parâmetro sem suporte | `unsupported` | true |
| `signal` do chamador | `aborted` | false |

Regra de fallback do consumidor: passe ao próximo alvo só com `retryOther && !emitted`.

Para diagnóstico, a lib lê o corpo do erro (inclusive o erro que chega no meio do stream):
`code` (`error.code`), `errorType` (`error.metadata.error_type`, `error.type` ou `error.status`),
`providerCode` e `providerName` (`error.metadata.provider_code` e `provider_name`, do OpenRouter).
`generationId` é o header `x-generation-id`, e vem também nos resultados de sucesso.

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

### Vocabulário

`OPERATIONS`, `INPUT_MODALITIES`, `OUTPUT_MODALITIES`, `METHODS_BY_OPERATION`, `formatShape`,
`parseShape`, `shapeOf`, `requestKey`, `isEligible`, `ineligibilityReason` — o pedido é operação +
forma (`chat text+image->text`).

## Outras operações


São chamada única: devolvem uma `Promise`, sem eventos. Cada operação tem o próprio modelo, com a
operação em `operations`; modelo sem ela, ou fio que não a implementa, dá `unsupported` antes do
fetch. Todas aceitam `signal` e `timeouts`, que vencem os da conta, e resolvem com `usage`, `cost` e
`generationId?`.

Gerar imagem tem 180 s de primeiro byte e de inatividade por padrão, porque a resposta só vem no
fim. O `timeouts` da conta vence esse padrão: uma conta com `firstByteMs: 60_000` corta imagem em 60 s.

```js
import { createClient } from 'ok-gateway-providers';

// OpenRouter: imagem em /images, sem response_format, e decisão em ../alpha/decisions.
const account = {
  id: 'openrouter-principal',
  provider: 'openrouter',
  api: 'openai-completions',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  compat: { imagePath: '/images', imageResponseFormat: null, decisionPath: '../alpha/decisions' },
};

const openai = { id: 'openai', provider: 'openai', api: 'openai-completions', baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY };
const groq = { id: 'groq', provider: 'groq', api: 'openai-completions', baseUrl: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY, compat: { sttResponseFormat: 'verbose_json' } };

const client = (id, operations, input, output, conta = account) => createClient({ account: conta, model: { id, operations, input, output } });

const embedder = client('text-embedding-3-small', ['embeddings'], ['text'], ['embeddings'], openai);
const { vectors } = await embedder.embed({ texts: ['olá'], dimensions: 768 });

const transcriber = client('whisper-large-v3-turbo', ['transcription'], ['audio'], ['text'], groq);
const bytes = new Uint8Array([0x49, 0x44, 0x33]);
const { text, durationSeconds } = await transcriber.transcribe({ audio: bytes, mime: 'audio/mpeg', filename: 'fala.mp3', language: 'pt' });

const speaker = client('tts-1', ['speech'], ['text'], ['audio'], openai);
const { audio, contentType } = await speaker.speak({ text: 'Olá', voice: 'onyx', format: 'mp3', instructions: 'Fale devagar', speed: 1.1 });

const painter = client('qwen/qwen-image-3', ['image-generation'], ['text'], ['image']);
const { images } = await painter.generateImage({ prompt: 'um gato', params: { n: 1 } });

const decider = client('typesafe/jev-1.13', ['decision'], ['text'], ['text']);
const { answers } = await decider.decide({
  state: { mensagem: 'pode mandar o relatório?' },
  questions: { pronto: { type: 'noul', instructions: 'O usuário autorizou o envio?', criteria: { true: 'autorizou', false: 'não autorizou' } } },
});
```

| Método | Pedido | Resultado (mais `usage`, `cost`, `generationId?`) |
|---|---|---|
| `embed` | `{ texts, dimensions?, params? }` | `{ vectors: number[][] }` |
| `transcribe` | `{ audio: Uint8Array, mime, filename?, language?, prompt?, params? }` | `{ text, durationSeconds? }` |
| `speak` | `{ text, voice?, format?, instructions?, speed?, params? }` | `{ audio: Uint8Array, contentType }` |
| `generateImage` | `{ prompt, params? }` | `{ images: [{ base64, mediaType }] }` |
| `decide` | `{ state, questions, params? }` | `{ answers }` |

Os tipos de cada par (`EmbedRequest`/`EmbedResult`, `TranscribeRequest`/`TranscribeResult`…) saem do
pacote.

- Na fala, `usage.input` é o número de caracteres, e `cost.input` é US$ por milhão de caracteres. O
  `contentType` vem do header do provedor quando é `audio/*`.
- Sem custo informado e sem tabela, `cost.usd` é `null`. A lib não inventa valor, e "nunca faturar
  zero" é regra de quem cobra.
- A lib não converte PCM em WAV, não normaliza idioma e não detecta o formato do áudio pelos bytes.
- `decide` precisa de `compat.decisionPath` na conta, e `questions` não pode ser vazio.

## `compat` por provedor

| Provedor | `api` | `compat` da conta |
|---|---|---|
| OpenRouter | `openai-completions` | `{ usageInStream: true, providerRouting: true, reasoningFormat: 'reasoning_object', imagePath: '/images', imageResponseFormat: null, decisionPath: '../alpha/decisions' }` |
| OpenAI, estilo chat | `openai-completions` | `{ usageInStream: true, maxTokensField: 'max_completion_tokens', reasoningFormat: 'reasoning_effort', structuredOutput: 'response_format', ttsDefaultVoice: 'onyx', ttsDefaultFormat: 'mp3' }` |
| Groq | `openai-completions` | `{ sttResponseFormat: 'verbose_json' }` |
| TypeSafe | `openai-completions` | `{ decisionPath: 'systemone' }` |
| Anthropic | `anthropic-messages` | padrão. No modelo da geração 5: `{ thinkingByDefault: true, supportsTemperature: false }` |
| Google | `google-generative-ai` | padrão |

No `whisper-1`, o modelo sobrescreve com `{ sttResponseFormat: 'verbose_json' }`. O
`anthropic-version` da conta (em `headers` ou em `compat.headers`) vence o padrão da lib.

`effort` e `reasoning.maxTokens` não vão juntos: o OpenRouter recusa, e a lib dá `invalid_request`.
`effort` explícito com `reasoning.max_tokens` vindo de `params` tira o `max_tokens`: o pedido vence
o padrão, e o teto de raciocínio do padrão some junto.

## Devolver o histórico

Para continuar uma conversa com tools, devolva o raciocínio assinado e os `providerData` que
vieram. `signature` fecha um bloco de raciocínio. Cada fio ignora ou aproveita o que recebe, então
o raciocínio de um provedor não vai para outro. Os ids `gemini-tc-{n}` se repetem entre respostas do
Gemini: cuidado ao levar uma conversa dele para a Anthropic, que pode recusar ids repetidos. O texto de cada bloco vai numa parte só.

```js
const content = [];
const toolCalls = [];
let text = null;     // parte de texto aberta: os deltas seguidos se juntam nela
let thinking = null; // bloco de raciocínio aberto, até a assinatura

for await (const ev of run) {
  if (ev.type === 'text') {
    if (!text) { text = { type: 'text', text: '' }; content.push(text); }
    text.text += ev.text;
  } else if (ev.type === 'reasoning') {
    text = null;
    if (ev.redacted) content.push({ type: 'reasoning', text: '', redacted: ev.redacted });
    else {
      if (!thinking) { thinking = { type: 'reasoning', text: '' }; content.push(thinking); }
      thinking.text += ev.text ?? '';
      if (ev.signature) { thinking.signature = ev.signature; thinking = null; }
    }
  } else if (ev.type === 'tool_call') {
    text = null;
    toolCalls.push({ id: ev.id, name: ev.name, arguments: ev.arguments, providerData: ev.providerData });
  }
}

messages.push({ role: 'assistant', content, toolCalls });
```

Parte `reasoning` sem assinatura (raciocínio de outro provedor) é ignorada em todos os fios.

## Catálogo

`parseOpenRouterModels(json)` transforma o `/api/v1/models` do OpenRouter (ou o `/v1/models` do Igris
Gateway, que fala o mesmo formato) em `Model[]`, com modalidades, operações, preço por milhão e o
compat que o `supported_parameters` declara. No formato do Gateway, `gateway.operation` define as
operações do modelo.

**Peça `?output_modalities=all`** ao OpenRouter: sem isso a API só lista modelos de saída texto, e os
de fala, transcrição, decisão e imagem não aparecem. Saída que o vocabulário não conhece (vídeo,
rerank) fica com `operations: []`.

## Desenvolver

```bash
npm test            # node --test, offline (fetch falso + fixtures gravadas)
npm run typecheck   # tsc --noEmit sobre o JSDoc
npm run build:types # gera types/ (entra no commit de cada versão)
```

`scripts/record-fixture.mjs` grava uma fixture a partir de uma chamada real (a chave vem
do ambiente e é removida do que vai para o disco).

`scripts/smoke.mjs` roda à mão antes de cada tag, com as chaves do ambiente (`OPENROUTER_API_KEY`,
`ANTHROPIC_API_KEY`, e opcionais `OPENAI_API_KEY`, `GROQ_API_KEY`, `GOOGLE_API_KEY`,
`TYPESAFE_API_KEY`). Provedor sem chave é pulado. Confere o chat (texto, tool call, imagem, PDF e
saída estruturada) e as operações (embeddings, transcrição, fala, imagem e decisão). Conta sem
crédito (402) não conta como falha: sai `PARCIAL`.

`scripts/smoke-cycle.mjs` faz o ciclo real de tool com pensamento ligado: chama com uma tool,
devolve o resultado e espera a resposta final, com e sem devolver o raciocínio assinado. O caso
"sem" mede se a assinatura é obrigatória; erro ali é informação, não falha.

## Licença

MIT.
