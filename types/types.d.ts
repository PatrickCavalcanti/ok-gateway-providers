export type Timeouts = import("./timeouts.js").Timeouts;
export type Api = "openai-completions" | "anthropic-messages" | "openai-responses" | "google-generative-ai";
export type Compat = {
    maxTokensField?: "max_tokens" | "max_completion_tokens" | "max_output_tokens" | undefined;
    supportsDeveloperRole?: boolean | undefined;
    supportsStore?: boolean | undefined;
    supportsTemperature?: boolean | undefined;
    reasoningFormat?: "reasoning_effort" | "reasoning_object" | "anthropic_thinking" | "none" | undefined;
    thinkingByDefault?: boolean | undefined;
    structuredOutput?: "none" | "response_format" | "top_level_json_schema" | "output_config" | undefined;
    usageInStream?: boolean | undefined;
    providerRouting?: boolean | undefined;
    cacheMarker?: "none" | "cache_control" | "prompt_cache_breakpoint" | undefined;
    headers?: Record<string, string> | undefined;
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
    audio?: "input_audio" | null | undefined;
    video?: "input_video" | "video_url" | null | undefined;
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
export type Part = {
    type: "text";
    text: string;
    cache?: CacheMark;
} | {
    type: "image";
    data?: string;
    url?: string;
    mime?: string;
} | {
    type: "audio";
    data: string;
    format: string;
} | {
    type: "video";
    data?: string;
    url?: string;
    mime?: string;
};
export type ToolCall = {
    id: string;
    name: string;
    arguments: string;
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
export type System = string | {
    text: string;
    cache?: CacheMark;
}[];
export type ChatRequest = {
    system?: System | undefined;
    messages: Message[];
    tools?: Tool[] | undefined;
    responseSchema?: ResponseSchema | undefined;
    effort?: Effort | undefined;
    maxTokens?: number | undefined;
    temperature?: number | undefined;
    params?: Record<string, unknown> | undefined;
    signal?: AbortSignal | undefined;
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
} | {
    type: "tool_call";
    id: string;
    name: string;
    arguments: string;
} | {
    type: "end";
    finishReason: string;
    usage: Usage;
    cost: CostResult;
};
export type ChatResult = {
    finishReason: string;
    usage: Usage;
    cost: CostResult;
};
/**
 * O que o fio devolve no `return` do `parseStream`.
 */
export type StreamSummary = {
    finishReason: string;
    usage: Usage;
    reportedCostUsd?: number | null;
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
    }) => AsyncGenerator<Exclude<ChatEvent, {
        type: "end";
    }>, StreamSummary, undefined>;
};
