import type { LLMProvider, Message } from './types.js';
import type { SkillRegistry } from './skill-registry.js';

const MAX_TOOL_ROUNDS = 10;

export class Assistant {
  private provider: LLMProvider;
  private registry: SkillRegistry;
  private systemPrompt: string;

  constructor(provider: LLMProvider, registry: SkillRegistry, timezone: string) {
    this.provider = provider;
    this.registry = registry;
    this.systemPrompt = [
      'You are Zaruka, a helpful personal AI assistant.',
      'You help the user manage tasks, check weather, and more.',
      `User timezone: ${timezone}. Current time: ${new Date().toLocaleString('en-US', { timeZone: timezone })}.`,
      'Be concise and friendly. Use the available tools when the user asks to create, list, complete, or delete tasks, check weather, etc.',
      'When creating tasks with due dates, parse natural language dates relative to the current date.',
    ].join('\n');
  }

  async process(userMessage: string): Promise<string> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: userMessage },
    ];

    const tools = this.registry.getAllTools();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.provider.chat(messages, tools.length > 0 ? tools : undefined);

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return response.text ?? '';
      }

      // Execute all tool calls and collect results
      const toolResults: string[] = [];
      for (const call of response.toolCalls) {
        const result = await this.registry.executeTool(call.name, call.params);
        toolResults.push(`[${call.name}]: ${result}`);
      }

      // Add assistant message with tool calls and tool results
      if (response.text) {
        messages.push({ role: 'assistant', content: response.text });
      }
      messages.push({
        role: 'assistant',
        content: `Tool calls: ${response.toolCalls.map(c => c.name).join(', ')}`,
      });
      messages.push({
        role: 'user',
        content: `Tool results:\n${toolResults.join('\n')}`,
      });
    }

    return 'I reached the maximum number of tool call rounds. Please try rephrasing your request.';
  }
}
