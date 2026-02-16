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
