import { streamText, stepCountIs } from 'ai';
export async function runAgent(opts) {
    // Capture the real stream error (e.g. RetryError with 429) so we can
    // rethrow it instead of the generic NoOutputGeneratedError.
    let streamError = null;
    const result = streamText({
        model: opts.model,
        system: opts.system,
        messages: opts.messages,
        tools: opts.tools,
        stopWhen: stepCountIs(opts.maxSteps ?? 10),
        onError: ({ error }) => {
            streamError = error;
            console.error(error);
        },
    });
    let text;
    let usage;
    let steps;
    try {
        [text, usage, steps] = await Promise.all([
            result.text,
            result.usage,
            result.steps,
        ]);
    }
    catch (err) {
        // Rethrow the actual stream error when available
        throw streamError ?? err;
    }
    // Collect text from all steps — the final `text` may be empty when the
    // model spent all steps on tool calls. Concatenating per-step text ensures
    // we capture any partial response the model produced along the way.
    let fullText = text || '';
    if (!fullText) {
        const parts = [];
        for (const step of steps) {
            if (step.text)
                parts.push(step.text);
        }
        fullText = parts.join('\n\n');
    }
    return {
        text: fullText,
        usedTools: steps.some((s) => s.toolCalls.length > 0),
        usage: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
        },
    };
}
//# sourceMappingURL=agent.js.map