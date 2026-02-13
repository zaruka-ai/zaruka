import type { Skill, ToolDefinition } from '../../core/types.js';
export declare class GmailSkill implements Skill {
    name: string;
    description: string;
    tools: ToolDefinition[];
    execute(_toolName: string, _params: Record<string, unknown>): Promise<string>;
}
//# sourceMappingURL=index.d.ts.map