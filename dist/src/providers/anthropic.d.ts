import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
export interface ChatMessage {
    role: 'user' | 'assistant';
    text: string;
}
export interface QueryUsage {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    model: string;
}
export type UsageCallback = (usage: QueryUsage) => void;
export declare class AgentSdkRunner {
    private model;
    private authToken?;
    private systemPrompt;
    private mcpServer;
    private onUsage?;
    constructor(opts: {
        model: string;
        authToken?: string;
        systemPrompt: string;
        mcpServer: McpSdkServerConfigWithInstance;
        onUsage?: UsageCallback;
    });
    process(userMessage: string, history?: ChatMessage[]): Promise<string>;
    private buildPrompt;
    private runQuery;
    /**
     * Detect when the model responded without tools but the request clearly needed action.
     * Triggers on: long responses that ask user to do manual steps, mention credentials, etc.
     * Does NOT trigger on: short greetings, simple answers, acknowledgments.
     */
    private shouldForceEvolve;
}
//# sourceMappingURL=anthropic.d.ts.map