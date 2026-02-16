import { streamText, stepCountIs } from 'ai';
export async function runAgent(opts) {
    const result = streamText({
        model: opts.model,
        system: opts.system,
        messages: opts.messages,
        tools: opts.tools,
        stopWhen: stepCountIs(opts.maxSteps ?? 10),
    });
    const [text, usage, steps] = await Promise.all([
        result.text,
        result.usage,
        result.steps,
    ]);
    return {
        text: text || '',
        usedTools: steps.some((s) => s.toolCalls.length > 0),
        usage: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
        },
    };
}
//# sourceMappingURL=agent.js.map