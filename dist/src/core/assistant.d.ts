import type { LanguageModel, ToolSet } from 'ai';
import { type StreamCallbacks } from '../ai/agent.js';
import { type AiConfig } from '../ai/model-factory.js';
export interface ChatMessage {
    role: 'user' | 'assistant';
    text: string;
}
export interface UsageCallback {
    (usage: {
        model: string;
        inputTokens: number;
        outputTokens: number;
    }): void;
}
export declare class Assistant {
    private model;
    private tools;
    private systemPrompt;
    private onUsage?;
    private fallbackConfigs;
    constructor(opts: {
        model: LanguageModel;
        tools: ToolSet;
        systemPrompt: string;
        onUsage?: UsageCallback;
        fallbackConfigs?: AiConfig[];
    });
    process(userMessage: string, history?: ChatMessage[]): Promise<string>;
    processStream(userMessage: string, history: ChatMessage[] | undefined, callbacks: StreamCallbacks): Promise<string>;
    private buildMessages;
}
//# sourceMappingURL=assistant.d.ts.map