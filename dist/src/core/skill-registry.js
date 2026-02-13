export class SkillRegistry {
    skills = new Map();
    toolToSkill = new Map();
    register(skill) {
        this.skills.set(skill.name, skill);
        for (const tool of skill.tools) {
            this.toolToSkill.set(tool.name, skill.name);
        }
    }
    getAllTools() {
        const tools = [];
        for (const skill of this.skills.values()) {
            tools.push(...skill.tools);
        }
        return tools;
    }
    async executeTool(toolName, params) {
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
        }
        catch (err) {
            return `Error executing ${toolName}: ${err instanceof Error ? err.message : String(err)}`;
        }
    }
    getSkills() {
        return Array.from(this.skills.values());
    }
}
//# sourceMappingURL=skill-registry.js.map