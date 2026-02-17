import { streamText, stepCountIs, type LanguageModel, type ToolSet, type ModelMessage } from 'ai';

export interface RunAgentResult {
  text: string;
  usedTools: boolean;
  usage: { inputTokens: number; outputTokens: number };
}

export async function runAgent(opts: {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  maxSteps?: number;
}): Promise<RunAgentResult> {
  // Capture the real stream error (e.g. RetryError with 429) so we can
  // rethrow it instead of the generic NoOutputGeneratedError.
  let streamError: unknown = null;

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

  let text: string;
  let usage: { inputTokens?: number; outputTokens?: number };
  let steps: Array<{ text: string; toolCalls: unknown[] }>;
  try {
    [text, usage, steps] = await Promise.all([
      result.text,
      result.usage,
      result.steps,
    ]);
  } catch (err) {
    // Rethrow the actual stream error when available
    throw streamError ?? err;
  }

  // Collect text from all steps — the final `text` may be empty when the
  // model spent all steps on tool calls. Concatenating per-step text ensures
  // we capture any partial response the model produced along the way.
  let fullText = text || '';
  if (!fullText) {
    const parts: string[] = [];
    for (const step of steps) {
      if (step.text) parts.push(step.text);
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
