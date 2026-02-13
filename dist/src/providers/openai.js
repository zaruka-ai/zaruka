import OpenAI from 'openai';
// OpenAI pricing (per 1M tokens) as of Feb 2025
const PRICING = {
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-4-turbo-preview': { input: 10.00, output: 30.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
    'gpt-4': { input: 30.00, output: 60.00 },
    'o1': { input: 15.00, output: 60.00 },
    'o1-mini': { input: 3.00, output: 12.00 },
    'o3-mini': { input: 1.10, output: 4.40 },
    // Local/self-hosted models (Ollama, LM Studio, etc.)
    'llama': { input: 0, output: 0 },
    'mistral': { input: 0, output: 0 },
    'mixtral': { input: 0, output: 0 },
    'qwen': { input: 0, output: 0 },
    'deepseek': { input: 0, output: 0 },
    'phi': { input: 0, output: 0 },
    'gemma': { input: 0, output: 0 },
};
function calculateCost(model, inputTokens, outputTokens, isOpenAiCompatible = false) {
    // Try exact match first
    let pricing = PRICING[model];
    // If not found, try prefix match (e.g., gpt-4o-2024-05-13 → gpt-4o)
    if (!pricing) {
        const lowerModel = model.toLowerCase();
        for (const [key, value] of Object.entries(PRICING)) {
            if (lowerModel.startsWith(key.toLowerCase())) {
                pricing = value;
                break;
            }
        }
    }
    // For OpenAI-compatible endpoints (often local/free models), default to $0
    // For official OpenAI, fallback to gpt-4o pricing
    if (!pricing) {
        pricing = isOpenAiCompatible ? { input: 0, output: 0 } : PRICING['gpt-4o'];
    }
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
export class OpenAIProvider {
    client;
    model;
    onUsage;
    isCompatibleEndpoint;
    constructor(apiKey, model = 'gpt-4o', baseUrl, onUsage) {
        this.client = new OpenAI({
            apiKey,
            ...(baseUrl ? { baseURL: baseUrl } : {}),
        });
        this.model = model;
        this.onUsage = onUsage;
        // If baseUrl is set, treat as compatible endpoint (likely local/free)
        this.isCompatibleEndpoint = !!baseUrl;
    }
    async chat(messages, tools) {
        const openaiMessages = messages.map(m => ({
            role: m.role,
            content: m.content,
        }));
        const openaiTools = tools?.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: openaiMessages,
            ...(openaiTools?.length ? { tools: openaiTools } : {}),
        });
        const choice = response.choices[0];
        if (!choice) {
            return { text: '' };
        }
        const text = choice.message.content || undefined;
        const toolCalls = [];
        if (choice.message.tool_calls) {
            for (const tc of choice.message.tool_calls) {
                toolCalls.push({
                    name: tc.function.name,
                    params: JSON.parse(tc.function.arguments),
                });
            }
        }
        // Track usage
        const usage = response.usage;
        if (usage && this.onUsage) {
            const inputTokens = usage.prompt_tokens || 0;
            const outputTokens = usage.completion_tokens || 0;
            const costUsd = calculateCost(this.model, inputTokens, outputTokens, this.isCompatibleEndpoint);
            this.onUsage({ model: this.model, inputTokens, outputTokens, costUsd });
        }
        return {
            text,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            usage: usage ? {
                inputTokens: usage.prompt_tokens || 0,
                outputTokens: usage.completion_tokens || 0,
            } : undefined,
        };
    }
}
//# sourceMappingURL=openai.js.map