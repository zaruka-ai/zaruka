import type { Skill, ToolDefinition } from './types.js';
export declare class SkillRegistry {
    private skills;
    private toolToSkill;
    register(skill: Skill): void;
    getAllTools(): ToolDefinition[];
    executeTool(toolName: string, params: Record<string, unknown>): Promise<string>;
    getSkills(): Skill[];
}
//# sourceMappingURL=skill-registry.d.ts.map