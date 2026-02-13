// === LLM Provider Types ===

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  params: Record<string, unknown>;
}

export interface LLMResponse {
  text?: string;
  toolCalls?: ToolCall[];
}

export interface LLMProvider {
  chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>;
}

// === Skill System ===

export interface Skill {
  name: string;
  description: string;
  tools: ToolDefinition[];
  execute(toolName: string, params: Record<string, unknown>): Promise<string>;
}

// === Task Model ===

export interface Task {
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  status: 'active' | 'completed' | 'deleted';
  source: string;
  source_ref: string | null;
  reminder_days: number;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}

// === Config ===

export interface ZarukaConfig {
  telegram: {
    botToken: string;
  };
  ai: {
    provider: 'anthropic' | 'openai' | 'openai-compatible';
    apiKey: string;
    model: string;
    baseUrl: string | null;
  };
  timezone: string;
  reminderCron: string;
}
