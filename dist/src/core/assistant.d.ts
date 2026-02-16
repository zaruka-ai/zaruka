import type { LanguageModel, ToolSet } from 'ai';
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
    constructor(opts: {
        model: LanguageModel;
        tools: ToolSet;
        systemPrompt: string;
        onUsage?: UsageCallback;
    });
    process(userMessage: string, history?: ChatMessage[]): Promise<string>;
    private buildMessages;
}
//# sourceMappingURL=assistant.d.ts.map