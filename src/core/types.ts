// === Task Model ===

export interface Task {
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string;               // HH:MM, default '12:00'
  recurrence: string | null;      // null | RRULE string (e.g. 'FREQ=DAILY', 'FREQ=HOURLY;INTERVAL=3')
  action: string | null;          // AI instruction (null = simple reminder)
  status: 'active' | 'completed' | 'deleted' | 'paused';
  source: string;
  source_ref: string | null;
  reminder_days: number;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}

// === Resource Monitoring ===

export interface ResourceThresholds {
  cpuPercent: number;    // default 90
  ramPercent: number;    // default 85
  diskPercent: number;   // default 90
}

export interface ResourceSnapshot {
  cpu: { usagePercent: number; cores: number; model: string };
  ram: {
    totalGB: number;
    usedGB: number;
    freeGB: number;
    usagePercent: number;
    swap: { totalGB: number; usedGB: number; freeGB: number } | null;
    effectiveUsagePercent: number;
  };
  disk: { totalGB: number; usedGB: number; freeGB: number; usagePercent: number; mount: string };
  timestamp: string;
}

// === User Profile ===

export interface UserProfile {
  name?: string;
  city?: string;
  timezone?: string;
  birthday?: string; // MM-DD format
}

// === MCP Server Config ===

export interface McpStdioConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpConfig {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig;

// === Config ===

export type AiProvider = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'groq' | 'xai' | 'qwen' | 'openai-compatible';

export type AiProviderConfig = {
  provider: AiProvider;
  apiKey?: string;
  authToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  model: string;
  baseUrl: string | null;
};

export interface ZarukaConfig {
  telegram: {
    botToken: string;
    chatId?: number;
  };
  ai?: AiProviderConfig;
  /** Previously configured providers, keyed by provider name. */
  savedProviders?: Record<string, AiProviderConfig>;
  profile?: UserProfile;
  timezone: string;
  language?: string;
  reminderCron: string;
  resourceMonitor?: {
    enabled: boolean;
    cronExpression: string;
    thresholds: ResourceThresholds;
  };
  /** Cached AI-translated UI strings. */
  uiTranslations?: { language: string; strings: Record<string, string> };
  /** MCP server configurations (Claude Desktop-compatible format). */
  mcpServers?: Record<string, McpServerConfig>;
}
