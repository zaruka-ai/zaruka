import { runAgent } from '../ai/agent.js';
import { createModel } from '../ai/model-factory.js';
const MAX_TOOL_ROUNDS = 10;
/**
 * Rough token budget for context window.
 * Most models support 200K; we leave headroom for the response.
 */
const MAX_CONTEXT_TOKENS = 180_000;
/** Reserve tokens for the model's response. */
const RESPONSE_RESERVE = 8_000;
function getModelId(model) {
    return typeof model === 'string' ? model : model.modelId;
}
/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
/** Patterns that indicate the error is provider-side and worth retrying with a fallback. */
const RETRIABLE_PATTERNS = [
    // Rate limit
    /\b429\b/, /rate.?limit/i, /quota/i, /RESOURCE_EXHAUSTED/i,
    // Auth
    /\b401\b/, /\b403\b/, /unauthorized/i, /forbidden/i,
    // Server errors
    /\b500\b/, /\b502\b/, /\b503\b/, /\b504\b/, /overloaded/i,
    // Network
    /timeout/i, /ETIMEDOUT/i, /ECONNRESET/i, /ECONNREFUSED/i,
];
function isRetriableForFailover(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return RETRIABLE_PATTERNS.some((re) => re.test(msg));
}
export class Assistant {
    model;
    tools;
    systemPrompt;
    onUsage;
    fallbackConfigs;
    constructor(opts) {
        this.model = opts.model;
        this.tools = opts.tools;
        this.systemPrompt = opts.systemPrompt;
        this.onUsage = opts.onUsage;
        this.fallbackConfigs = opts.fallbackConfigs ?? [];
    }
    async process(userMessage, history) {
        const messages = this.buildMessages(userMessage, history);
        // Try primary model first, then fallbacks on retriable errors
        let lastError;
        const attempts = [
            { model: this.model, label: 'primary' },
            ...this.fallbackConfigs.map((cfg) => ({
                model: createModel(cfg),
                label: `${cfg.provider}/${cfg.model}`,
            })),
        ];
        for (const attempt of attempts) {
            try {
                const { text, usage } = await runAgent({
                    model: attempt.model,
                    system: this.systemPrompt,
                    messages,
                    tools: this.tools,
                    maxSteps: MAX_TOOL_ROUNDS,
                });
                if (this.onUsage) {
                    this.onUsage({
                        model: getModelId(attempt.model),
                        inputTokens: usage.inputTokens,
                        outputTokens: usage.outputTokens,
                    });
                }
                return text;
            }
            catch (err) {
                lastError = err;
                if (!isRetriableForFailover(err) || attempt === attempts[attempts.length - 1]) {
                    throw err;
                }
                const errMsg = err instanceof Error ? err.message : String(err);
                console.warn(`[failover] ${attempt.label} failed (${errMsg}), trying next provider...`);
            }
        }
        // Should never reach here, but just in case
        throw lastError;
    }
    buildMessages(userMessage, history) {
        // Estimate fixed overhead: system prompt + tool definitions
        const systemTokens = estimateTokens(this.systemPrompt);
        const toolsTokens = estimateTokens(JSON.stringify(Object.keys(this.tools)));
        // Each tool definition adds description + schema; rough estimate
        const toolDefTokens = Object.keys(this.tools).length * 200;
        const fixedTokens = systemTokens + toolsTokens + toolDefTokens + RESPONSE_RESERVE;
        const userMsgTokens = estimateTokens(userMessage);
        let budget = MAX_CONTEXT_TOKENS - fixedTokens - userMsgTokens;
        const messages = [];
        // Add history messages newest-first until budget runs out
        if (history && history.length > 0) {
            const fitting = [];
            for (let i = history.length - 1; i >= 0; i--) {
                const m = history[i];
                const truncated = m.text.length > 1000 ? m.text.slice(0, 1000) + '...' : m.text;
                const tokens = estimateTokens(truncated);
                if (tokens > budget)
                    break;
                budget -= tokens;
                fitting.push({ role: m.role, content: truncated });
            }
            // Reverse back to chronological order
            fitting.reverse();
            messages.push(...fitting);
        }
        messages.push({ role: 'user', content: userMessage });
        return messages;
    }
}
//# sourceMappingURL=assistant.js.map