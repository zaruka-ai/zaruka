import type { LLMProvider, Message, LLMResponse, ToolDefinition } from '../core/types.js';
export type UsageCallback = (usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}) => void;
export declare class OpenAIProvider implements LLMProvider {
    private client;
    private model;
    private onUsage?;
    protected isCompatibleEndpoint: boolean;
    constructor(apiKey: string, model?: string, baseUrl?: string | null, onUsage?: UsageCallback);
    chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>;
}
//# sourceMappingURL=openai.d.ts.map