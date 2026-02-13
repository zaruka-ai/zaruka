import OpenAI from 'openai';
import type { LLMProvider, Message, LLMResponse, ToolDefinition, ToolCall } from '../core/types.js';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = 'gpt-4o', baseUrl?: string | null) {
    this.client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
    this.model = model;
  }

  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      ...(openaiTools?.length ? { tools: openaiTools } : {}),
    });

    const choice = response.choices[0];
    if (!choice) {
      return { text: '' };
    }

    const text = choice.message.content || undefined;
    const toolCalls: ToolCall[] = [];

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          name: tc.function.name,
          params: JSON.parse(tc.function.arguments),
        });
      }
    }

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
