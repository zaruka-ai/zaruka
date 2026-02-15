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
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}
export interface LLMProvider {
    chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>;
}
export interface Skill {
    name: string;
    description: string;
    tools: ToolDefinition[];
    execute(toolName: string, params: Record<string, unknown>): Promise<string>;
}
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
export interface ResourceThresholds {
    cpuPercent: number;
    ramPercent: number;
    diskPercent: number;
}
export interface ResourceSnapshot {
    cpu: {
        usagePercent: number;
        cores: number;
        model: string;
    };
    ram: {
        totalGB: number;
        usedGB: number;
        freeGB: number;
        usagePercent: number;
        swap: {
            totalGB: number;
            usedGB: number;
            freeGB: number;
        } | null;
        effectiveUsagePercent: number;
    };
    disk: {
        totalGB: number;
        usedGB: number;
        freeGB: number;
        usagePercent: number;
        mount: string;
    };
    timestamp: string;
}
export interface UserProfile {
    name?: string;
    city?: string;
    timezone?: string;
    birthday?: string;
}
export interface ZarukaConfig {
    telegram: {
        botToken: string;
        chatId?: number;
    };
    ai?: {
        provider: 'anthropic' | 'openai' | 'openai-compatible';
        apiKey?: string;
        authToken?: string;
        refreshToken?: string;
        tokenExpiresAt?: string;
        model: string;
        baseUrl: string | null;
    };
    profile?: UserProfile;
    timezone: string;
    language?: string;
    reminderCron: string;
    resourceMonitor?: {
        enabled: boolean;
        cronExpression: string;
        thresholds: ResourceThresholds;
    };
}
//# sourceMappingURL=types.d.ts.map