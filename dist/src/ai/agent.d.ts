import { type LanguageModel, type ToolSet, type ModelMessage } from 'ai';
export interface RunAgentResult {
    text: string;
    usedTools: boolean;
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}
export interface StreamCallbacks {
    onTextDelta: (delta: string) => void;
}
export declare function runAgentStream(opts: {
    model: LanguageModel;
    system: string;
    messages: ModelMessage[];
    tools: ToolSet;
    maxSteps?: number;
    callbacks: StreamCallbacks;
}): Promise<RunAgentResult>;
export declare function runAgent(opts: {
    model: LanguageModel;
    system: string;
    messages: ModelMessage[];
    tools: ToolSet;
    maxSteps?: number;
}): Promise<RunAgentResult>;
//# sourceMappingURL=agent.d.ts.map