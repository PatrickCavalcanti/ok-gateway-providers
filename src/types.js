// ok-gateway-providers — typedefs JSDoc compartilhados (spec §4–§5).
// Este módulo não tem código de runtime; existe para os `import('./types.js')` dos outros.

/** @typedef {import('./timeouts.js').Timeouts} Timeouts */

/** @typedef {'openai-completions'|'anthropic-messages'|'openai-responses'|'google-generative-ai'} Api */

/**
 * @typedef {object} Compat
 * @property {'max_tokens'|'max_completion_tokens'|'max_output_tokens'} [maxTokensField]
 * @property {boolean} [supportsDeveloperRole]
 * @property {boolean} [supportsStore]
 * @property {boolean} [supportsTemperature]
 * @property {'reasoning_effort'|'reasoning_object'|'anthropic_thinking'|'none'} [reasoningFormat]
 * @property {boolean} [thinkingByDefault]
 * @property {'response_format'|'top_level_json_schema'|'output_config'|'response_json_schema'|'none'} [structuredOutput]
 * @property {boolean} [usageInStream]
 * @property {boolean} [providerRouting]
 * @property {'cache_control'|'prompt_cache_breakpoint'|'none'} [cacheMarker]
 * @property {Record<string, string>} [headers]
 * @property {'json'|'verbose_json'} [sttResponseFormat]
 * @property {string|null} [ttsDefaultVoice]
 * @property {string|null} [ttsDefaultFormat]
 * @property {string} [imagePath]
 * @property {string|null} [imageResponseFormat]
 * @property {string|null} [decisionPath]
 */

/** @typedef {Required<Compat>} ResolvedCompat */

/**
 * @typedef {object} Account
 * @property {string} id
 * @property {string} provider  'openrouter', 'anthropic', 'inception', 'igris-gateway'…
 * @property {Api} api
 * @property {string} baseUrl
 * @property {string | (() => string | Promise<string>)} apiKey  função: token renovável
 * @property {Record<string, string>} [headers]
 * @property {Compat} [compat]
 * @property {Timeouts} [timeouts]
 */

/**
 * US$ por milhão de tokens (formato pi-ai + extensões).
 * @typedef {object} Cost
 * @property {number} input
 * @property {number} output
 * @property {number} [cacheRead]
 * @property {number} [cacheWrite]
 * @property {number} [cacheWrite1h]
 * @property {number} [audioPerSecond]
 * @property {number} [minBilledSeconds]
 * @property {number} [cacheStoragePerMTokHour]
 * @property {CostTier[]} [tiers]
 */

/**
 * Faixa de preço: vale quando o prompt total passa de `aboveInputTokens`. Taxa que a
 * faixa não declara fica a base (spec §15.3).
 * @typedef {object} CostTier
 * @property {number} aboveInputTokens
 * @property {number} [input]
 * @property {number} [output]
 * @property {number} [cacheRead]
 * @property {number} [cacheWrite]
 * @property {number} [cacheWrite1h]
 */

/**
 * @typedef {object} Transport
 * @property {('data-url'|'url')[]} [image]  padrão ['data-url','url']
 * @property {'input_audio'|'inline_data'|null} [audio]
 * @property {'input_video'|'video_url'|'inline_data'|null} [video]
 * @property {('data-url'|'url')[]} [file]  padrão ['data-url'] (documento: PDF, texto…)
 */

/**
 * @typedef {object} Model
 * @property {string} id
 * @property {string} [name]
 * @property {import('./vocabulary.js').Operation[]} operations
 * @property {import('./vocabulary.js').InputModality[]} input
 * @property {import('./vocabulary.js').OutputModality[]} output
 * @property {boolean} [reasoning]
 * @property {number} [contextWindow]
 * @property {number} [maxTokens]
 * @property {Cost} [cost]
 * @property {Compat} [compat]
 * @property {Transport} [transport]
 * @property {Record<string, unknown>} [params]  passthrough para o corpo
 * @property {Record<string, unknown>} [meta]    o que o catálogo trouxe e a lib não interpreta
 */

/** @typedef {{ ttl?: '5m'|'1h' }} CacheMark */

/**
 * @typedef {{ type: 'text', text: string, cache?: CacheMark }
 *   | { type: 'image', data?: string, url?: string, mime?: string, cache?: CacheMark }
 *   | { type: 'audio', data: string, format?: string }
 *   | { type: 'video', data?: string, url?: string, mime?: string }
 *   | { type: 'file', data?: string, url?: string, mime?: string, name?: string, cache?: CacheMark }
 *   | { type: 'reasoning', text: string, signature?: string, redacted?: string }} Part
 *   `reasoning` só existe no papel `assistant`. A Anthropic o devolve (`thinking` com `signature`, ou
 *   `redacted_thinking`); os outros fios o ignoram de propósito, para o fallback entre modelos funcionar
 */

/**
 * @typedef {object} ToolCall
 * @property {string} id
 * @property {string} name
 * @property {string} arguments
 * @property {Record<string, unknown>} [providerData]  dado opaco do provedor, que o chamador guarda e devolve
 *   na mesma chamada. Gemini: `thoughtSignature`. Os outros fios ignoram
 */

/**
 * @typedef {object} Message
 * @property {'user'|'assistant'|'tool'} role
 * @property {string | Part[]} content
 * @property {ToolCall[]} [toolCalls]   só no papel assistant
 * @property {string} [toolCallId]      só no papel tool
 * @property {string} [toolName]        só no papel tool: nome da tool chamada. O fio Google o usa quando a
 *   chamada não está na lista (ficou num prefixo cacheado); os outros fios ignoram
 * @property {boolean} [isError]        só no papel tool: o resultado é um erro. Anthropic: `is_error`; Gemini:
 *   `response.error`; os outros fios: prefixo `Tool error: ` no texto
 */

/** @typedef {{ name: string, description?: string, parameters: Record<string, unknown> }} Tool */
/** @typedef {{ name?: string, schema: Record<string, unknown>, strict?: boolean }} ResponseSchema */
/** @typedef {'none'|'low'|'medium'|'high'|'xhigh'} Effort */
/** @typedef {'auto'|'none'|'required'|{ name: string }} ToolChoice */
/** @typedef {string | { text: string, cache?: CacheMark }[]} System */

/**
 * @typedef {object} ChatRequest
 * @property {System} [system]
 * @property {Message[]} messages
 * @property {Tool[]} [tools]
 * @property {ResponseSchema} [responseSchema]
 * @property {string} [cachedContent]  referência a um `cachedContents/…` do Gemini; os outros fios dão `unsupported`
 * @property {ToolChoice} [toolChoice]  exige `tools`; sem elas é `invalid_request`
 * @property {string[]} [stop]  textos que encerram a geração
 * @property {Effort} [effort]
 * @property {{ maxTokens?: number, exclude?: boolean }} [reasoning]  além do `effort`; só o formato
 *   `reasoning_object` (OpenRouter) aceita, nos outros é `unsupported`
 * @property {number} [maxTokens]
 * @property {number} [temperature]
 * @property {Record<string, unknown>} [params]
 * @property {AbortSignal} [signal]
 * @property {import('./timeouts.js').Timeouts} [timeouts]
 */

// ---------------------------------------------------------------------------------------
// Operações de chamada única (spec T1.2 §3): um par pedido/resultado por método do cliente.

/**
 * @typedef {object} CallOptions  o que todo pedido aceita
 * @property {AbortSignal} [signal]
 * @property {Timeouts} [timeouts]  vence o `timeouts` da conta
 */

/**
 * O que todo resultado de operação traz, além do dado.
 * @typedef {object} OperationResult
 * @property {Usage} usage
 * @property {CostResult} cost  `usd: null` quando não há como calcular (a política de "nunca faturar zero" é de quem cobra)
 * @property {string} [generationId]  header `x-generation-id`, quando vier
 */

/**
 * @typedef {CallOptions & {
 *   texts: string[],
 *   dimensions?: number,
 *   params?: Record<string, unknown>,
 * }} EmbedRequest
 */
/** @typedef {OperationResult & { vectors: number[][] }} EmbedResult */

/**
 * @typedef {CallOptions & {
 *   audio: Uint8Array,
 *   mime: string,
 *   filename?: string,
 *   language?: string,
 *   prompt?: string,
 *   params?: Record<string, unknown>,
 * }} TranscribeRequest
 */
/** @typedef {OperationResult & { text: string, durationSeconds?: number }} TranscribeResult */

/**
 * @typedef {CallOptions & {
 *   text: string,
 *   voice?: string,
 *   format?: string,
 *   instructions?: string,
 *   speed?: number,
 *   params?: Record<string, unknown>,
 * }} SpeakRequest
 */
/** @typedef {OperationResult & { audio: Uint8Array, contentType: string }} SpeakResult */

/** @typedef {CallOptions & { prompt: string, params?: Record<string, unknown> }} GenerateImageRequest */
/** @typedef {OperationResult & { images: { base64: string, mediaType: string }[] }} GenerateImageResult */

/**
 * Uma pergunta da decisão. O formato fica com o serviço; o conhecido é `{ type, instructions, criteria }`.
 * @typedef {{ type?: string, instructions?: string, criteria?: Record<string, string> } & Record<string, unknown>} DecisionQuestion
 */
/**
 * @typedef {CallOptions & {
 *   state: Record<string, unknown>,
 *   questions: Record<string, DecisionQuestion>,
 *   params?: Record<string, unknown>,
 * }} DecideRequest
 */
/** @typedef {OperationResult & { answers: Record<string, unknown> }} DecideResult */

/**
 * Operação (nome do vocabulário) → [pedido, resultado]. `runOperation` e o cliente leem daqui.
 * @typedef {{
 *   embeddings: [EmbedRequest, EmbedResult],
 *   transcription: [TranscribeRequest, TranscribeResult],
 *   speech: [SpeakRequest, SpeakResult],
 *   'image-generation': [GenerateImageRequest, GenerateImageResult],
 *   decision: [DecideRequest, DecideResult],
 * }} OperationTypes
 */

/**
 * O cliente de uma conta e um modelo. Cada método atende uma operação de `METHODS_BY_OPERATION`.
 * @typedef {object} Client
 * @property {Account} account
 * @property {Model} model
 * @property {(request: ChatRequest) => import('./client.js').Run} chat
 * @property {(request: EmbedRequest) => Promise<EmbedResult>} embed
 * @property {(request: TranscribeRequest) => Promise<TranscribeResult>} transcribe
 * @property {(request: SpeakRequest) => Promise<SpeakResult>} speak
 * @property {(request: GenerateImageRequest) => Promise<GenerateImageResult>} generateImage
 * @property {(request: DecideRequest) => Promise<DecideResult>} decide
 */


/**
 * `input` sem o cache lido nem gravado. `cacheWrite` = escrita de 5 min; `cacheWrite1h`
 * = escrita de 1 h (disjuntos).
 * @typedef {object} Usage
 * @property {number} input
 * @property {number} output
 * @property {number} cacheRead
 * @property {number} cacheWrite
 * @property {number} cacheWrite1h
 * @property {number} [reasoning]
 * @property {number} [audioSeconds]
 * @property {number} [cacheStorageTokenHours]
 * @property {boolean} [missing]  true quando o provedor não declarou uso nenhum: o custo
 *   pela tabela vira `{ usd: null, source: 'none' }`, nunca US$ 0
 * @property {unknown} [raw]
 */

/** @typedef {{ usd: number|null, source: 'provider'|'table'|'none' }} CostResult */

/**
 * @typedef {{ type: 'text', text: string }
 *   | { type: 'reasoning', text: string, signature?: string, redacted?: string }
 *   | { type: 'tool_call', id: string, name: string, arguments: string, providerData?: Record<string, unknown> }
 *   | { type: 'end', finishReason: string, usage: Usage, cost: CostResult, generationId?: string }} ChatEvent
 */

/**
 * `generationId`: id da geração no provedor (header `x-generation-id`), para diagnóstico; some quando o
 * provedor não manda.
 * @typedef {{ finishReason: string, usage: Usage, cost: CostResult, generationId?: string }} ChatResult
 */

/**
 * O que o fio devolve no `return` do `parseStream`.
 * @typedef {{ finishReason: string, usage: Usage, reportedCostUsd?: number|null }} StreamSummary
 */

/**
 * O que `parseResponse` recebe. `json()` e `bytes()` leem o corpo uma vez só.
 * @typedef {object} OneShotResponse
 * @property {number} status
 * @property {Headers} headers
 * @property {() => Promise<any>} json   JSON inválido vira ProviderError `upstream`
 * @property {() => Promise<Uint8Array>} bytes
 */

/**
 * @typedef {object} OperationContext
 * @property {Account} account
 * @property {Model} model
 * @property {ResolvedCompat} compat
 * @property {any} request
 */

/**
 * @typedef {object} OperationModule
 * @property {(args: OperationContext & { apiKey: string }) => { url: string, headers: Record<string, string>, body: Record<string, unknown> | FormData }} buildRequest
 * @property {(res: OneShotResponse, ctx: OperationContext) => Promise<{ result: Record<string, unknown>, usage: Usage, reportedCostUsd?: number|null }>} parseResponse
 */

/**
 * @typedef {object} ApiModule
 * @property {Api} api
 * @property {(args: { account: Account, model: Model, compat: ResolvedCompat, request: ChatRequest, apiKey: string }) => { url: string, headers: Record<string, string>, body: Record<string, unknown> }} buildRequest
 * @property {(events: AsyncIterable<import('./sse.js').SSEEvent>, ctx: { account: Account, model: Model, compat: ResolvedCompat, headers: Headers }) => AsyncGenerator<Exclude<ChatEvent, { type: 'end' }>, StreamSummary, undefined>} parseStream
 * @property {Partial<Record<Exclude<import('./vocabulary.js').Operation, 'chat'>, OperationModule>>} [operations]
 */

export {};
