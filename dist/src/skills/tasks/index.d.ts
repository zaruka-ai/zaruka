import type { Skill, ToolDefinition } from '../../core/types.js';
import type { TaskRepository } from '../../db/repository.js';
export declare class TasksSkill implements Skill {
    name: string;
    description: string;
    private repo;
    tools: ToolDefinition[];
    constructor(repo: TaskRepository);
    execute(toolName: string, params: Record<string, unknown>): Promise<string>;
}
//# sourceMappingURL=index.d.ts.map