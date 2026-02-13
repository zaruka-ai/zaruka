import type { LLMProvider } from './types.js';
import type { SkillRegistry } from './skill-registry.js';
import type { AgentSdkRunner, ChatMessage } from '../providers/anthropic.js';
export declare class Assistant {
    private provider;
    private registry;
    private sdkRunner;
    private systemPrompt;
    constructor(opts: {
        provider?: LLMProvider;
        registry?: SkillRegistry;
        sdkRunner?: AgentSdkRunner;
        timezone: string;
    });
    process(userMessage: string, history?: ChatMessage[]): Promise<string>;
}
//# sourceMappingURL=assistant.d.ts.map