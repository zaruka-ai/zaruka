import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
/** Known base URLs for providers that use the OpenAI-compatible protocol. */
const PROVIDER_BASE_URLS = {
    deepseek: 'https://api.deepseek.com',
    groq: 'https://api.groq.com/openai/v1',
    xai: 'https://api.x.ai/v1',
};
function createProvider(ai) {
    if (ai.provider === 'anthropic') {
        const p = createAnthropic({
            ...(ai.apiKey ? { apiKey: ai.apiKey } : {}),
            ...(ai.authToken ? {
                authToken: ai.authToken,
                headers: { 'anthropic-beta': 'oauth-2025-04-20' },
            } : {}),
        });
        return (model) => p(model);
    }
    if (ai.provider === 'google') {
        const p = createGoogleGenerativeAI({
            apiKey: ai.apiKey || '',
        });
        return (model) => p(model);
    }
    // OpenAI with ChatGPT OAuth — use ChatGPT backend API
    if (ai.provider === 'openai' && ai.authToken) {
        const openai = createOpenAI({
            apiKey: ai.authToken,
            baseURL: 'https://chatgpt.com/backend-api/codex',
            headers: {
                'version': '1.0.0',
                'OpenAI-Beta': 'responses=experimental',
                'originator': 'codex_cli_rs',
            },
            // ChatGPT backend has strict requirements different from standard OpenAI API
            fetch: async (url, init) => {
                if (init?.method === 'POST' && init?.body && typeof init.body === 'string') {
                    try {
                        const body = JSON.parse(init.body);
                        body.store = false;
                        body.stream = true;
                        if (!body.instructions)
                            body.instructions = 'You are a helpful assistant.';
                        if (!body.tools)
                            body.tools = [];
                        if (!body.tool_choice)
                            body.tool_choice = 'auto';
                        if (body.parallel_tool_calls === undefined)
                            body.parallel_tool_calls = false;
                        // These fields are not supported by the ChatGPT backend
                        delete body.max_output_tokens;
                        delete body.max_completion_tokens;
                        init = { ...init, body: JSON.stringify(body) };
                    }
                    catch { /* not JSON, pass through */ }
                }
                return globalThis.fetch(url, init);
            },
        });
        return (model) => openai(model);
    }
    // openai, deepseek, groq, xai, openai-compatible — all use OpenAI SDK
    const baseURL = ai.baseUrl || PROVIDER_BASE_URLS[ai.provider] || undefined;
    const isThirdParty = ai.provider !== 'openai';
    const openai = createOpenAI({
        apiKey: ai.apiKey || 'no-key',
        ...(baseURL ? { baseURL } : {}),
        ...(isThirdParty ? { compatibility: 'compatible' } : {}),
    });
    // Third-party providers only support Chat Completions API, not the Responses API
    return (model) => isThirdParty ? openai.chat(model) : openai(model);
}
/** Create a LanguageModel for the user's chosen model. */
export function createModel(ai) {
    return createProvider(ai)(ai.model);
}
/**
 * Create a LanguageModel for the best available model from the user's provider.
 * Queries the provider API to find the flagship model dynamically.
 * Falls back to the user's configured model if the API call fails.
 */
export async function createBestModel(ai) {
    const provider = createProvider(ai);
    try {
        const bestId = await fetchBestModelId(ai);
        if (bestId)
            return provider(bestId);
    }
    catch (err) {
        console.warn('Failed to fetch best model, using configured model:', err instanceof Error ? err.message : err);
    }
    return provider(ai.model);
}
/** Best-known models per provider (used as fallback for evolve_skill). */
const BEST_MODELS = {
    anthropic: 'claude-opus-4-6',
    openai: 'gpt-4o',
    google: 'gemini-2.5-pro',
    deepseek: 'deepseek-chat',
    groq: 'llama-3.3-70b-versatile',
    xai: 'grok-3',
};
/**
 * Query the provider API and return the ID of the most capable model.
 */
async function fetchBestModelId(ai) {
    if (ai.provider === 'anthropic') {
        return fetchBestAnthropicModel(ai);
    }
    if (ai.provider === 'openai') {
        return fetchBestOpenAIModel(ai);
    }
    // For other providers, return static best model
    return BEST_MODELS[ai.provider] ?? null;
}
// Anthropic model families ranked by capability (best first)
const ANTHROPIC_FAMILY_RANK = ['opus', 'sonnet', 'haiku'];
async function fetchBestAnthropicModel(ai) {
    const key = ai.apiKey || ai.authToken;
    if (!key)
        return null;
    const headers = { 'anthropic-version': '2023-06-01' };
    if (ai.authToken) {
        headers['Authorization'] = `Bearer ${ai.authToken}`;
        headers['anthropic-beta'] = 'oauth-2025-04-20';
    }
    else {
        headers['x-api-key'] = key;
    }
    const resp = await fetch('https://api.anthropic.com/v1/models?limit=20', {
        headers,
        signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok)
        return null;
    const data = await resp.json();
    if (!data.data?.length)
        return null;
    // Sort: best family first, then newest within each family
    const sorted = data.data.sort((a, b) => {
        const rankA = ANTHROPIC_FAMILY_RANK.findIndex((f) => a.id.includes(f));
        const rankB = ANTHROPIC_FAMILY_RANK.findIndex((f) => b.id.includes(f));
        const ra = rankA === -1 ? 999 : rankA;
        const rb = rankB === -1 ? 999 : rankB;
        if (ra !== rb)
            return ra - rb;
        return b.created_at.localeCompare(a.created_at);
    });
    return sorted[0].id;
}
async function fetchBestOpenAIModel(ai) {
    // ChatGPT OAuth — use the ChatGPT backend models endpoint
    if (ai.authToken) {
        return fetchBestChatGPTModel(ai);
    }
    const key = ai.apiKey;
    if (!key)
        return null;
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
        apiKey: key,
        ...(ai.baseUrl ? { baseURL: ai.baseUrl } : {}),
    });
    const list = await client.models.list();
    const models = [];
    for await (const m of list) {
        models.push({ id: m.id, created: m.created });
    }
    // Filter to chat-capable models, prefer newest
    const chatModels = models
        .filter((m) => /^(gpt-|o[1-9]|chatgpt-)/.test(m.id) && !m.id.includes('realtime') && !m.id.includes('audio'))
        .sort((a, b) => b.created - a.created);
    return chatModels[0]?.id ?? null;
}
async function fetchBestChatGPTModel(ai) {
    if (!ai.authToken)
        return null;
    try {
        const resp = await fetch('https://chatgpt.com/backend-api/codex/models?client_version=1.0.0', {
            headers: { 'Authorization': `Bearer ${ai.authToken}` },
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok)
            return null;
        const data = await resp.json();
        // Pick the highest-priority visible model
        const visible = data.models
            .filter((m) => m.visibility === 'list')
            .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
        return visible[0]?.slug ?? null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=model-factory.js.map