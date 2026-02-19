import type { LanguageModel, ToolSet, ModelMessage } from 'ai';
import { runAgent, runAgentStream, type StreamCallbacks } from '../ai/agent.js';
import { createModel, type AiConfig } from '../ai/model-factory.js';

const MAX_TOOL_ROUNDS = 10;

/**
 * Rough token budget for context window.
 * Most models support 200K; we leave headroom for the response.
 */
const MAX_CONTEXT_TOKENS = 180_000;

/** Reserve tokens for the model's response. */
const RESPONSE_RESERVE = 8_000;

export interface Attachment {
  type: 'image' | 'file';
  data: Buffer;
  mediaType: string;
  fileName?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  fileType?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
}

export interface ProcessResult {
  text: string;
  /** Set when the primary provider failed and a fallback succeeded. */
  switchedTo?: AiConfig;
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

/** Patterns that indicate the error is provider-side and worth retrying with a fallback. */
const RETRIABLE_PATTERNS = [
  // Rate limit
  /\b429\b/, /rate.?limit/i, /quota/i, /RESOURCE_EXHAUSTED/i,
  // Auth
  /\b401\b/, /\b403\b/, /unauthorized/i, /forbidden/i,
  // Server errors
  /\b500\b/, /\b502\b/, /\b503\b/, /\b504\b/, /overloaded/i,
  // Network
  /timeout/i, /ETIMEDOUT/i, /ECONNRESET/i, /ECONNREFUSED/i,
];

function isRetriableForFailover(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return RETRIABLE_PATTERNS.some((re) => re.test(msg));
}

export class Assistant {
  private model: LanguageModel;
  private tools: ToolSet;
  private systemPrompt: string;
  private onUsage?: UsageCallback;
  private fallbackConfigs: AiConfig[];

  constructor(opts: {
    model: LanguageModel;
    tools: ToolSet;
    systemPrompt: string;
    onUsage?: UsageCallback;
    fallbackConfigs?: AiConfig[];
  }) {
    this.model = opts.model;
    this.tools = opts.tools;
    this.systemPrompt = opts.systemPrompt;
    this.onUsage = opts.onUsage;
    this.fallbackConfigs = opts.fallbackConfigs ?? [];
  }

  async process(userMessage: string, history?: ChatMessage[], attachments?: Attachment[]): Promise<ProcessResult> {
    const messages = this.buildMessages(userMessage, history, attachments);

    // Try primary model first, then fallbacks on retriable errors
    let lastError: unknown;
    const attempts: Array<{ model: LanguageModel; label: string; config?: AiConfig }> = [
      { model: this.model, label: 'primary' },
      ...this.fallbackConfigs.map((cfg) => ({
        model: createModel(cfg),
        label: `${cfg.provider}/${cfg.model}`,
        config: cfg,
      })),
    ];

    for (const attempt of attempts) {
      try {
        const { text, usage } = await runAgent({
          model: attempt.model,
          system: this.systemPrompt,
          messages,
          tools: this.tools,
          maxSteps: MAX_TOOL_ROUNDS,
        });

        if (this.onUsage) {
          this.onUsage({
            model: getModelId(attempt.model),
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          });
        }

        return { text, switchedTo: attempt.config };
      } catch (err) {
        lastError = err;
        if (!isRetriableForFailover(err) || attempt === attempts[attempts.length - 1]) {
          throw err;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[failover] ${attempt.label} failed (${errMsg}), trying next provider...`);
      }
    }

    // Should never reach here, but just in case
    throw lastError;
  }

  async processStream(
    userMessage: string,
    history: ChatMessage[] | undefined,
    callbacks: StreamCallbacks,
    attachments?: Attachment[],
  ): Promise<ProcessResult> {
    const messages = this.buildMessages(userMessage, history, attachments);

    let lastError: unknown;
    const attempts: Array<{ model: LanguageModel; label: string; config?: AiConfig }> = [
      { model: this.model, label: 'primary' },
      ...this.fallbackConfigs.map((cfg) => ({
        model: createModel(cfg),
        label: `${cfg.provider}/${cfg.model}`,
        config: cfg,
      })),
    ];

    for (const attempt of attempts) {
      try {
        const { text, usage } = await runAgentStream({
          model: attempt.model,
          system: this.systemPrompt,
          messages,
          tools: this.tools,
          maxSteps: MAX_TOOL_ROUNDS,
          callbacks,
        });

        if (this.onUsage) {
          this.onUsage({
            model: getModelId(attempt.model),
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          });
        }

        return { text, switchedTo: attempt.config };
      } catch (err) {
        lastError = err;
        if (!isRetriableForFailover(err) || attempt === attempts[attempts.length - 1]) {
          throw err;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[failover] ${attempt.label} failed (${errMsg}), trying next provider...`);
      }
    }

    throw lastError;
  }

  private buildMessages(userMessage: string, history?: ChatMessage[], attachments?: Attachment[]): ModelMessage[] {
    // Estimate fixed overhead: system prompt + tool definitions
    const systemTokens = estimateTokens(this.systemPrompt);
    const toolsTokens = estimateTokens(JSON.stringify(Object.keys(this.tools)));
    // Each tool definition adds description + schema; rough estimate
    const toolDefTokens = Object.keys(this.tools).length * 200;

    const attachmentTokens = attachments
      ? attachments.reduce((sum, a) => sum + (a.type === 'image' ? 1500 : Math.ceil(a.data.length / 4)), 0)
      : 0;

    const fixedTokens = systemTokens + toolsTokens + toolDefTokens + RESPONSE_RESERVE;
    const userMsgTokens = estimateTokens(userMessage) + attachmentTokens;
    let budget = MAX_CONTEXT_TOKENS - fixedTokens - userMsgTokens;

    const messages: ModelMessage[] = [];

    // Add history messages newest-first until budget runs out
    if (history && history.length > 0) {
      const fitting: ModelMessage[] = [];
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        // For history messages with attachments, prepend metadata text
        let text = m.text;
        if (m.fileType) {
          const label = m.fileType === 'photo'
            ? '[Attached: photo]'
            : `[Attached: ${m.fileName || 'document'}]`;
          text = `${label}\n${text}`;
        }
        const truncated = text.length > 1000 ? text.slice(0, 1000) + '...' : text;
        const tokens = estimateTokens(truncated);
        if (tokens > budget) break;
        budget -= tokens;
        fitting.push({ role: m.role, content: truncated });
      }
      // Reverse back to chronological order
      fitting.reverse();
      messages.push(...fitting);
    }

    // Build current user message — multimodal if attachments present
    if (attachments && attachments.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = [];
      for (const attachment of attachments) {
        if (attachment.type === 'image') {
          parts.push({ type: 'image', image: attachment.data, mimeType: attachment.mediaType });
        } else {
          parts.push({ type: 'file', data: attachment.data, mimeType: attachment.mediaType, filename: attachment.fileName });
        }
      }
      if (userMessage) {
        parts.push({ type: 'text', text: userMessage });
      }
      messages.push({ role: 'user', content: parts });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    return messages;
  }
}
