import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { TaskRepository } from '../db/repository.js';
import type { UsageRepository } from '../db/usage-repository.js';
export declare function createTaskTools(repo: TaskRepository): SdkMcpToolDefinition<any>[];
export declare function createResourceTools(): SdkMcpToolDefinition<any>[];
export declare function createUsageTools(usageRepo: UsageRepository): SdkMcpToolDefinition<any>[];
export declare function createWeatherTools(): SdkMcpToolDefinition<any>[];
//# sourceMappingURL=skill-tools.d.ts.map