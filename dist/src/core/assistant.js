import { runAgent } from '../ai/agent.js';
const MAX_TOOL_ROUNDS = 10;
function getModelId(model) {
    return typeof model === 'string' ? model : model.modelId;
}
export class Assistant {
    model;
    tools;
    systemPrompt;
    onUsage;
    constructor(opts) {
        this.model = opts.model;
        this.tools = opts.tools;
        this.systemPrompt = opts.systemPrompt;
        this.onUsage = opts.onUsage;
    }
    async process(userMessage, history) {
        const messages = this.buildMessages(userMessage, history);
        const { text, usage } = await runAgent({
            model: this.model,
            system: this.systemPrompt,
            messages,
            tools: this.tools,
            maxSteps: MAX_TOOL_ROUNDS,
        });
        if (this.onUsage) {
            this.onUsage({
                model: getModelId(this.model),
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
            });
        }
        return text;
    }
    buildMessages(userMessage, history) {
        const messages = [];
        if (history && history.length > 0) {
            for (const m of history) {
                const truncated = m.text.length > 500 ? m.text.slice(0, 500) + '...' : m.text;
                messages.push({ role: m.role, content: truncated });
            }
        }
        messages.push({ role: 'user', content: userMessage });
        return messages;
    }
}
//# sourceMappingURL=assistant.js.map