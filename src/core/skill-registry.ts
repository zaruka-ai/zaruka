import type { Skill, ToolDefinition } from './types.js';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private toolToSkill: Map<string, string> = new Map();

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
    for (const tool of skill.tools) {
      this.toolToSkill.set(tool.name, skill.name);
    }
  }

  getAllTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const skill of this.skills.values()) {
      tools.push(...skill.tools);
    }
    return tools;
  }

  async executeTool(toolName: string, params: Record<string, unknown>): Promise<string> {
    const skillName = this.toolToSkill.get(toolName);
    if (!skillName) {
      return `Error: Unknown tool "${toolName}"`;
    }
    const skill = this.skills.get(skillName);
    if (!skill) {
      return `Error: Skill "${skillName}" not found`;
    }
    try {
      return await skill.execute(toolName, params);
    } catch (err) {
      return `Error executing ${toolName}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }
}
