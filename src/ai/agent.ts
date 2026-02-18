import { streamText, stepCountIs, type LanguageModel, type ToolSet, type ModelMessage } from 'ai';

export interface RunAgentResult {
  text: string;
  usedTools: boolean;
  usage: { inputTokens: number; outputTokens: number };
}

function isPromptTooLong(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /prompt.*(too long|too large|exceeds.*limit|token.*limit)/i.test(msg)
    || /max.*context.*length/i.test(msg)
    || /maximum.*tokens/i.test(msg);
}

async function executeStream(opts: {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  maxSteps: number;
}): Promise<RunAgentResult> {
  // Capture the real stream error (e.g. RetryError with 429) so we can
  // rethrow it instead of the generic NoOutputGeneratedError.
  let streamError: unknown = null;

  const result = streamText({
    model: opts.model,
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    stopWhen: stepCountIs(opts.maxSteps),
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

export async function runAgent(opts: {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  maxSteps?: number;
}): Promise<RunAgentResult> {
  const maxSteps = opts.maxSteps ?? 10;

  try {
    return await executeStream({ ...opts, maxSteps });
  } catch (err) {
    if (!isPromptTooLong(err)) throw err;

    console.warn('Prompt too long — retrying with only the last user message');

    // Keep only the last user message
    const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) throw err;

    try {
      return await executeStream({
        ...opts,
        messages: [lastUserMsg],
        maxSteps,
      });
    } catch (retryErr) {
      if (isPromptTooLong(retryErr)) {
        throw new Error(
          'The prompt is too long even with a single message. '
          + 'Try disconnecting some MCP servers or shortening your message.',
        );
      }
      throw retryErr;
    }
  }
}
