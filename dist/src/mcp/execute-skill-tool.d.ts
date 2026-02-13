import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
/**
 * Dynamically load a skill tool from the skills directory and execute it.
 * This allows newly created skills (from evolve_skill) to be used immediately
 * without restarting the bot.
 */
export declare function createExecuteSkillTool(skillsDir: string): SdkMcpToolDefinition<any>;
//# sourceMappingURL=execute-skill-tool.d.ts.map