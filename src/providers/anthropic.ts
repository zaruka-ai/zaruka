import { query } from '@anthropic-ai/claude-agent-sdk';
import type { LLMProvider, Message, LLMResponse, ToolDefinition } from '../core/types.js';

export class AnthropicProvider implements LLMProvider {
  private model: string;
  private authToken?: string;

  constructor(model = 'claude-haiku-4-5-20251001', authToken?: string) {
    this.model = model;
    this.authToken = authToken;
  }

  async chat(messages: Message[], _tools?: ToolDefinition[]): Promise<LLMResponse> {
    const systemMsg = messages.find(m => m.role === 'system');
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');

    if (!lastUserMsg) {
      return { text: 'No user message provided.' };
    }

    let resultText = '';

    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    if (this.authToken) {
      cleanEnv.CLAUDE_CODE_OAUTH_TOKEN = this.authToken;
    }

    const conversation = query({
      prompt: lastUserMsg.content,
      options: {
        model: this.model,
        systemPrompt: systemMsg?.content,
        maxTurns: 1,
        tools: [],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        env: cleanEnv,
      },
    });

    for await (const msg of conversation) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (typeof block === 'object' && 'text' in block) {
            resultText += block.text;
          }
        }
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success' && msg.result) {
          resultText = msg.result;
        }
      }
    }

    return { text: resultText || undefined };
  }
}
