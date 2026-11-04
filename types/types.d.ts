export type Timeouts = import("./timeouts.js").Timeouts;
export type Api = "openai-completions" | "anthropic-messages" | "openai-responses" | "google-generative-ai";
export type Compat = {
    maxTokensField?: "max_tokens" | "max_completion_tokens" | "max_output_tokens" | undefined;
    supportsDeveloperRole?: boolean | undefined;
    supportsStore?: boolean | undefined;
    supportsTemperature?: boolean | undefined;
    reasoningFormat?: "none" | "reasoning_effort" | "reasoning_object" | "anthropic_thinking" | undefined;
    thinkingByDefault?: boolean | undefined;
    structuredOutput?: "none" | "response_format" | "top_level_json_schema" | "output_config" | "response_json_schema" | "text_format" | undefined;
    usageInStream?: boolean | undefined;
    providerRouting?: boolean | undefined;
    cacheMarker?: "none" | "cache_control" | "prompt_cache_breakpoint" | undefined;
    headers?: Record<string, string> | undefined;
    sttResponseFormat?: "json" | "verbose_json" | undefined;
    ttsDefaultVoice?: string | null | undefined;
    ttsDefaultFormat?: string | null | undefined;
    imagePath?: string | undefined;
    imageResponseFormat?: string | null | undefined;
    decisionPath?: string | null | undefined;
};
export type ResolvedCompat = Required<Compat>;
export type Account = {
    id: string;
    /**
     * 'openrouter', 'anthropic', 'inception', 'igris-gateway'…
     */
    provider: string;
    api: Api;
    baseUrl: string;
    /**
     * função: token renovável
     */
    apiKey: string | (() => string | Promise<string>);
    headers?: Record<string, string> | undefined;
    compat?: Compat | undefined;
    timeouts?: import("./timeouts.js").Timeouts | undefined;
};
/**
 * US$ por milhão de tokens (formato pi-ai + extensões).
 */
export type Cost = {
    input: number;
    output: number;
    cacheRead?: number | undefined;
    cacheWrite?: number | undefined;
    cacheWrite1h?: number | undefined;
    audioPerSecond?: number | undefined;
    minBilledSeconds?: number | undefined;
    cacheStoragePerMTokHour?: number | undefined;
    tiers?: CostTier[] | undefined;
};
/**
 * Faixa de preço: vale quando o prompt total passa de `aboveInputTokens`. Taxa que a
 * faixa não declara fica a base (spec §15.3).
 */
export type CostTier = {
    aboveInputTokens: number;
    input?: number | undefined;
    output?: number | undefined;
    cacheRead?: number | undefined;
    cacheWrite?: number | undefined;
    cacheWrite1h?: number | undefined;
};
export type Transport = {
    /**
     * padrão ['data-url','url']
     */
    image?: ("data-url" | "url")[] | undefined;
    audio?: "input_audio" | "inline_data" | null | undefined;
    video?: "inline_data" | "input_video" | "video_url" | null | undefined;
    /**
     * padrão ['data-url'] (documento: PDF, texto…)
     */
    file?: ("data-url" | "url")[] | undefined;
};
export type Model = {
    id: string;
    name?: string | undefined;
    operations: import("./vocabulary.js").Operation[];
    input: import("./vocabulary.js").InputModality[];
    output: import("./vocabulary.js").OutputModality[];
    reasoning?: boolean | undefined;
    contextWindow?: number | undefined;
    maxTokens?: number | undefined;
    cost?: Cost | undefined;
    compat?: Compat | undefined;
    transport?: Transport | undefined;
    /**
     * passthrough para o corpo
     */
    params?: Record<string, unknown> | undefined;
    /**
     * o que o catálogo trouxe e a lib não interpreta
     */
    meta?: Record<string, unknown> | undefined;
};
export type CacheMark = {
    ttl?: "5m" | "1h";
};
/**
 * `reasoning` só existe no papel `assistant`. A Anthropic o devolve (`thinking` com `signature`, ou
 * `redacted_thinking`); os outros fios o ignoram de propósito, para o fallback entre modelos funcionar
 */
export type Part = {
    type: "text";
    text: string;
    cache?: CacheMark;
} | {
    type: "image";
    data?: string;
    url?: string;
    mime?: string;
    cache?: CacheMark;
} | {
    type: "audio";
    data: string;
    format?: string;
} | {
    type: "video";
    data?: string;
    url?: string;
    mime?: string;
} | {
    type: "file";
    data?: string;
    url?: string;
    mime?: string;
    name?: string;
    cache?: CacheMark;
} | {
    type: "reasoning";
    text: string;
    signature?: string;
    redacted?: string;
};
export type ToolCall = {
    id: string;
    name: string;
    arguments: string;
    /**
     * dado opaco do provedor, que o chamador guarda e devolve
     * na mesma chamada. Gemini: `thoughtSignature`. Os outros fios ignoram
     */
    providerData?: Record<string, unknown> | undefined;
};
export type Message = {
    role: "user" | "assistant" | "tool";
    content: string | Part[];
    /**
     * só no papel assistant
     */
    toolCalls?: ToolCall[] | undefined;
    /**
     * só no papel tool
     */
    toolCallId?: string | undefined;
    /**
     * só no papel tool: nome da tool chamada. O fio Google o usa quando a
     * chamada não está na lista (ficou num prefixo cacheado); os outros fios ignoram
     */
    toolName?: string | undefined;
    /**
     * só no papel tool: o resultado é um erro. Anthropic: `is_error`; Gemini:
     * `response.error`; os outros fios: prefixo `Tool error: ` no texto
     */
    isError?: boolean | undefined;
};
export type Tool = {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
};
export type ResponseSchema = {
    name?: string;
    schema: Record<string, unknown>;
    strict?: boolean;
};
export type Effort = "none" | "low" | "medium" | "high" | "xhigh";
export type ToolChoice = "auto" | "none" | "required" | {
    name: string;
};
export type System = string | {
    text: string;
    cache?: CacheMark;
}[];
export type ChatRequest = {
    system?: System | undefined;
    messages: Message[];
    tools?: Tool[] | undefined;
    responseSchema?: ResponseSchema | undefined;
    /**
     * referência a um `cachedContents/…` do Gemini; os outros fios dão `unsupported`
     */
    cachedContent?: string | undefined;
    /**
     * exige `tools`; sem elas é `invalid_request`
     */
    toolChoice?: ToolChoice | undefined;
    /**
     * textos que encerram a geração
     */
    stop?: string[] | undefined;
    effort?: Effort | undefined;
    /**
     * além do `effort`; só o formato
     * `reasoning_object` (OpenRouter) aceita, nos outros é `unsupported`
     */
    reasoning?: {
        maxTokens?: number;
        exclude?: boolean;
    } | undefined;
    maxTokens?: number | undefined;
    temperature?: number | undefined;
    params?: Record<string, unknown> | undefined;
    signal?: AbortSignal | undefined;
    timeouts?: import("./timeouts.js").Timeouts | undefined;
};
/**
 * o que todo pedido aceita
 */
export type CallOptions = {
    signal?: AbortSignal | undefined;
    /**
     * vence o `timeouts` da conta
     */
    timeouts?: import("./timeouts.js").Timeouts | undefined;
};
/**
 * O que todo resultado de operação traz, além do dado.
 */
export type OperationResult = {
    usage: Usage;
    /**
     * `usd: null` quando não há como calcular (a política de "nunca faturar zero" é de quem cobra)
     */
    cost: CostResult;
    /**
     * header `x-generation-id`, quando vier
     */
    generationId?: string | undefined;
};
export type EmbedRequest = CallOptions & {
    texts: string[];
    dimensions?: number;
    params?: Record<string, unknown>;
};
export type EmbedResult = OperationResult & {
    vectors: number[][];
};
export type TranscribeRequest = CallOptions & {
    audio: Uint8Array;
    mime: string;
    filename?: string;
    language?: string;
    prompt?: string;
    params?: Record<string, unknown>;
};
export type TranscribeResult = OperationResult & {
    text: string;
    durationSeconds?: number;
};
export type SpeakRequest = CallOptions & {
    text: string;
    voice?: string;
    format?: string;
    instructions?: string;
    speed?: number;
    params?: Record<string, unknown>;
};
export type SpeakResult = OperationResult & {
    audio: Uint8Array;
    contentType: string;
};
export type GenerateImageRequest = CallOptions & {
    prompt: string;
    params?: Record<string, unknown>;
};
export type GenerateImageResult = OperationResult & {
    images: {
        base64: string;
        mediaType: string;
    }[];
};
/**
 * Uma pergunta da decisão. O formato fica com o serviço; o conhecido é `{ type, instructions, criteria }`.
 */
export type DecisionQuestion = {
    type?: string;
    instructions?: string;
    criteria?: Record<string, string>;
} & Record<string, unknown>;
export type DecideRequest = CallOptions & {
    state: Record<string, unknown>;
    questions: Record<string, DecisionQuestion>;
    params?: Record<string, unknown>;
};
export type DecideResult = OperationResult & {
    answers: Record<string, unknown>;
};
/**
 * Operação (nome do vocabulário) → [pedido, resultado]. `runOperation` e o cliente leem daqui.
 */
export type OperationTypes = {
    embeddings: [EmbedRequest, EmbedResult];
    transcription: [TranscribeRequest, TranscribeResult];
    speech: [SpeakRequest, SpeakResult];
    "image-generation": [GenerateImageRequest, GenerateImageResult];
    decision: [DecideRequest, DecideResult];
};
/**
 * O cliente de uma conta e um modelo. Cada método atende uma operação de `METHODS_BY_OPERATION`.
 */
export type Client = {
    account: Account;
    model: Model;
    chat: (request: ChatRequest) => import("./client.js").Run;
    embed: (request: EmbedRequest) => Promise<EmbedResult>;
    transcribe: (request: TranscribeRequest) => Promise<TranscribeResult>;
    speak: (request: SpeakRequest) => Promise<SpeakResult>;
    generateImage: (request: GenerateImageRequest) => Promise<GenerateImageResult>;
    decide: (request: DecideRequest) => Promise<DecideResult>;
};
/**
 * `input` sem o cache lido nem gravado. `cacheWrite` = escrita de 5 min; `cacheWrite1h`
 * = escrita de 1 h (disjuntos).
 */
export type Usage = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite1h: number;
    reasoning?: number | undefined;
    audioSeconds?: number | undefined;
    cacheStorageTokenHours?: number | undefined;
    /**
     * true quando o provedor não declarou uso nenhum: o custo
     * pela tabela vira `{ usd: null, source: 'none' }`, nunca US$ 0
     */
    missing?: boolean | undefined;
    raw?: unknown;
};
export type CostResult = {
    usd: number | null;
    source: "provider" | "table" | "none";
};
export type ChatEvent = {
    type: "text";
    text: string;
} | {
    type: "reasoning";
    text: string;
    signature?: string;
    redacted?: string;
} | {
    type: "tool_call";
    id: string;
    name: string;
    arguments: string;
    providerData?: Record<string, unknown>;
} | {
    type: "end";
    finishReason: string;
    usage: Usage;
    cost: CostResult;
    generationId?: string;
};
/**
 * `generationId`: id da geração no provedor (header `x-generation-id`), para diagnóstico; some quando o
 * provedor não manda.
 */
export type ChatResult = {
    finishReason: string;
    usage: Usage;
    cost: CostResult;
    generationId?: string;
};
/**
 * O que o fio devolve no `return` do `parseStream`.
 */
export type StreamSummary = {
    finishReason: string;
    usage: Usage;
    reportedCostUsd?: number | null;
};
/**
 * O que `parseResponse` recebe. `json()` e `bytes()` leem o corpo uma vez só.
 */
export type OneShotResponse = {
    status: number;
    headers: Headers;
    /**
     * JSON inválido vira ProviderError `upstream`
     */
    json: () => Promise<any>;
    bytes: () => Promise<Uint8Array>;
};
export type OperationContext = {
    account: Account;
    model: Model;
    compat: ResolvedCompat;
    request: any;
};
export type OperationModule = {
    buildRequest: (args: OperationContext & {
        apiKey: string;
    }) => {
        url: string;
        headers: Record<string, string>;
        body: Record<string, unknown> | FormData;
    };
    parseResponse: (res: OneShotResponse, ctx: OperationContext) => Promise<{
        result: Record<string, unknown>;
        usage: Usage;
        reportedCostUsd?: number | null;
    }>;
};
export type ApiModule = {
    api: Api;
    buildRequest: (args: {
        account: Account;
        model: Model;
        compat: ResolvedCompat;
        request: ChatRequest;
        apiKey: string;
    }) => {
        url: string;
        headers: Record<string, string>;
        body: Record<string, unknown>;
    };
    parseStream: (events: AsyncIterable<import("./sse.js").SSEEvent>, ctx: {
        account: Account;
        model: Model;
        compat: ResolvedCompat;
        headers: Headers;
    }) => AsyncGenerator<Exclude<ChatEvent, {
        type: "end";
    }>, StreamSummary, undefined>;
    operations?: Partial<Record<"image-generation" | "embeddings" | "decision" | "transcription" | "speech", OperationModule>> | undefined;
};
