import type { LanguageModel, ToolSet, ModelMessage } from 'ai';
import { runAgent } from '../ai/agent.js';

const MAX_TOOL_ROUNDS = 10;

/**
 * Rough token budget for context window.
 * Most models support 200K; we leave headroom for the response.
 */
const MAX_CONTEXT_TOKENS = 180_000;

/** Reserve tokens for the model's response. */
const RESPONSE_RESERVE = 8_000;

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

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
    // Estimate fixed overhead: system prompt + tool definitions
    const systemTokens = estimateTokens(this.systemPrompt);
    const toolsTokens = estimateTokens(JSON.stringify(Object.keys(this.tools)));
    // Each tool definition adds description + schema; rough estimate
    const toolDefTokens = Object.keys(this.tools).length * 200;

    const fixedTokens = systemTokens + toolsTokens + toolDefTokens + RESPONSE_RESERVE;
    const userMsgTokens = estimateTokens(userMessage);
    let budget = MAX_CONTEXT_TOKENS - fixedTokens - userMsgTokens;

    const messages: ModelMessage[] = [];

    // Add history messages newest-first until budget runs out
    if (history && history.length > 0) {
      const fitting: ModelMessage[] = [];
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        const truncated = m.text.length > 1000 ? m.text.slice(0, 1000) + '...' : m.text;
        const tokens = estimateTokens(truncated);
        if (tokens > budget) break;
        budget -= tokens;
        fitting.push({ role: m.role, content: truncated });
      }
      // Reverse back to chronological order
      fitting.reverse();
      messages.push(...fitting);
    }

    messages.push({ role: 'user', content: userMessage });
    return messages;
  }
}
