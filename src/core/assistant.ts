import type { LanguageModel, ToolSet, ModelMessage } from 'ai';
import { runAgent } from '../ai/agent.js';

const MAX_TOOL_ROUNDS = 10;

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface UsageCallback {
  (usage: { model: string; inputTokens: number; outputTokens: number }): void;
}

function getModelId(model: LanguageModel): string {
  return typeof model === 'string' ? model : model.modelId;
}

export class Assistant {
  private model: LanguageModel;
  private tools: ToolSet;
  private systemPrompt: string;
  private onUsage?: UsageCallback;

  constructor(opts: {
    model: LanguageModel;
    tools: ToolSet;
    systemPrompt: string;
    onUsage?: UsageCallback;
  }) {
    this.model = opts.model;
    this.tools = opts.tools;
    this.systemPrompt = opts.systemPrompt;
    this.onUsage = opts.onUsage;
  }

  async process(userMessage: string, history?: ChatMessage[]): Promise<string> {
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

  private buildMessages(userMessage: string, history?: ChatMessage[]): ModelMessage[] {
    const messages: ModelMessage[] = [];

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
