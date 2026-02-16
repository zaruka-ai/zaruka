import OpenAI from 'openai';
import { PROVIDER_BASE_URLS } from './providers.js';
const CACHE_TTL = 3_600_000; // 1 hour
let cache = null;
export function clearModelsCache() {
    cache = null;
}
const PROVIDER_FILTERS = {
    openai: {
        include: /^(gpt-|o[1-9]|chatgpt-)/,
        exclude: /realtime|audio|transcri|tts|dall-e|embedding|moderation/,
    },
    groq: {
        exclude: /whisper|playai|orpheus|guard|safeguard|compound/i,
    },
};
// ---------------------------------------------------------------------------
// Popular model families per provider.
// For each regex, the best match is picked: shortest ID first (aliases are
// shorter than dated snapshots), then alphabetically last (higher version).
// ---------------------------------------------------------------------------
const POPULAR_FAMILIES = {
    anthropic: [/opus/, /sonnet/, /haiku/],
    openai: [/^o\d/, /^gpt-5|^gpt-4o/, /mini/],
    google: [/-pro/, /-flash(?!.*lite)/, /-flash-lite/],
    deepseek: [/^deepseek-chat/, /^deepseek-reasoner/],
    groq: [/llama.*70b/i, /llama.*(maverick|scout)/i, /qwen|deepseek/i],
    xai: [/^grok-\d/, /mini/, /fast/],
};
/**
 * From a list of models and family patterns, select the best model per family.
 */
function selectPopular(models, families) {
    const result = [];
    const used = new Set();
    for (const pattern of families) {
        const candidates = models.filter((m) => pattern.test(m.id) && !used.has(m.id));
        if (candidates.length === 0)
            continue;
        // Shortest ID = alias/latest; then alphabetically last = higher version
        const best = candidates.sort((a, b) => a.id.length - b.id.length || b.id.localeCompare(a.id))[0];
        result.push(best);
        used.add(best.id);
    }
    return result;
}
// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function fetchAvailableModels(ai) {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
        return cache.result;
    }
    try {
        let all;
        switch (ai.provider) {
            case 'anthropic':
                all = await fetchAnthropicModels(ai);
                break;
            case 'google':
                all = await fetchGoogleModels(ai);
                break;
            case 'openai':
            default:
                // ChatGPT OAuth: use the ChatGPT backend API (works even if provider is undefined during onboarding)
                all = ai.authToken
                    ? await fetchChatGPTModels(ai)
                    : await fetchOpenAICompatibleModels(ai);
                break;
        }
        const families = POPULAR_FAMILIES[ai.provider];
        const popular = families ? selectPopular(all, families) : [];
        const result = { popular, all };
        if (all.length > 0) {
            cache = { result, fetchedAt: Date.now() };
        }
        return result;
    }
    catch (err) {
        console.error('Failed to fetch models:', err instanceof Error ? err.message : err);
        return { popular: [], all: [] };
    }
}
// ---------------------------------------------------------------------------
// Provider-specific fetchers
// ---------------------------------------------------------------------------
async function fetchAnthropicModels(ai) {
    const key = ai.apiKey || ai.authToken;
    if (!key)
        return [];
    try {
        const headers = {
            'anthropic-version': '2023-06-01',
        };
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
            return [];
        const data = await resp.json();
        return data.data.map((m) => ({ id: m.id, label: m.display_name }));
    }
    catch {
        return [];
    }
}
async function fetchGoogleModels(ai) {
    const key = ai.apiKey;
    if (!key)
        return [];
    try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok)
            return [];
        const data = await resp.json();
        return data.models
            .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
            .filter((m) => /gemini/i.test(m.name))
            .map((m) => ({
            id: m.name.replace('models/', ''),
            label: m.displayName,
        }));
    }
    catch {
        return [];
    }
}
async function fetchChatGPTModels(ai) {
    if (!ai.authToken)
        return [];
    try {
        const resp = await fetch('https://chatgpt.com/backend-api/codex/models?client_version=1.0.0', {
            headers: {
                'Authorization': `Bearer ${ai.authToken}`,
            },
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok)
            return [];
        const data = await resp.json();
        return data.models
            .filter((m) => m.visibility === 'list')
            .map((m) => ({ id: m.slug, label: m.display_name }));
    }
    catch {
        return [];
    }
}
async function fetchOpenAICompatibleModels(ai) {
    const key = ai.apiKey || ai.authToken;
    const baseURL = ai.baseUrl || PROVIDER_BASE_URLS[ai.provider] || undefined;
    const client = new OpenAI({
        apiKey: key || 'no-key',
        ...(baseURL ? { baseURL } : {}),
    });
    const list = await client.models.list();
    const allModels = [];
    for await (const m of list) {
        allModels.push(m);
    }
    const filter = PROVIDER_FILTERS[ai.provider];
    let filtered = allModels;
    if (filter?.include) {
        const inc = filter.include;
        filtered = filtered.filter((m) => inc.test(m.id));
    }
    if (filter?.exclude) {
        const exc = filter.exclude;
        filtered = filtered.filter((m) => !exc.test(m.id));
    }
    return filtered
        .sort((a, b) => b.created - a.created)
        .map((m) => ({ id: m.id, label: m.id }));
}
//# sourceMappingURL=models.js.map