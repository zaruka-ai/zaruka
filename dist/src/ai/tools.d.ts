import type { ToolSet } from 'ai';
import type { TaskRepository } from '../db/repository.js';
import type { MessageRepository } from '../db/message-repository.js';
import type { UsageRepository } from '../db/usage-repository.js';
import type { ConfigManager } from '../core/config-manager.js';
import type { AiConfig } from './model-factory.js';
export interface ToolDeps {
    taskRepo: TaskRepository;
    messageRepo: MessageRepository;
    usageRepo: UsageRepository;
    configManager: ConfigManager;
    skillsDir: string;
    aiConfig: AiConfig;
    memoryDir: string;
}
export declare function createAllTools(deps: ToolDeps): ToolSet;
//# sourceMappingURL=tools.d.ts.map