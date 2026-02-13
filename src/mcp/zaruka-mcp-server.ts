import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { TaskRepository } from '../db/repository.js';
import type { MessageRepository } from '../db/message-repository.js';
import { createTaskTools, createWeatherTools, createResourceTools } from './skill-tools.js';
import { createEvolveTool } from './evolve-tool.js';
import { createCredentialTool } from './credential-tool.js';
import { createExecuteSkillTool } from './execute-skill-tool.js';
import { createHistoryTools } from './history-tools.js';
import { loadDynamicSkills } from '../skills/dynamic-loader.js';

export interface ZarukaMcpOptions {
  taskRepo: TaskRepository;
  messageRepo: MessageRepository;
  skillsDir: string;
  authToken?: string;
}

export async function createZarukaMcpServer(opts: ZarukaMcpOptions): Promise<McpSdkServerConfigWithInstance> {
  const builtinTools = [
    ...createTaskTools(opts.taskRepo),
    ...createWeatherTools(),
    ...createResourceTools(),
    ...createHistoryTools(opts.messageRepo),
    createCredentialTool(),
    createExecuteSkillTool(opts.skillsDir),
    createEvolveTool(opts.skillsDir, opts.authToken),
  ];

  const dynamicTools = await loadDynamicSkills(opts.skillsDir);

  return createSdkMcpServer({
    name: 'zaruka',
    version: '0.1.0',
    tools: [...builtinTools, ...dynamicTools],
  });
}
