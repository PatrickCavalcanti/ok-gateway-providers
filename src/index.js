// ok-gateway-providers — exports públicos.

import { registerApi } from './client.js';
import * as openaiCompletions from './apis/openai-completions.js';
import * as anthropicMessages from './apis/anthropic-messages.js';

registerApi(openaiCompletions);
registerApi(anthropicMessages);

export { createClient, registerApi, getApi, listApis } from './client.js';
/** Tipos públicos (Account, Model, ChatRequest, ChatEvent, Usage, Cost…). */
export * from './types.js';
export * from './vocabulary.js';
export { ProviderError, errorFromStatus, unsupported, typeFromStatus, truncateBody, MAX_BODY_BYTES } from './errors.js';
export { createDeadline, DEFAULT_TIMEOUTS } from './timeouts.js';
export { readSSE } from './sse.js';
export { resolveCompat, DEFAULT_COMPAT } from './compat.js';
export { computeCost, tierFor } from './cost.js';
export { createCreditConverter } from './credits.js';
export { parseOpenRouterModels } from './catalog/openrouter.js';
