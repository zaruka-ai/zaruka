import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createTaskTools, createWeatherTools, createResourceTools } from './skill-tools.js';
import { createEvolveTool } from './evolve-tool.js';
import { createCredentialTool } from './credential-tool.js';
import { createExecuteSkillTool } from './execute-skill-tool.js';
import { createHistoryTools } from './history-tools.js';
import { loadDynamicSkills } from '../skills/dynamic-loader.js';
export async function createZarukaMcpServer(opts) {
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
//# sourceMappingURL=zaruka-mcp-server.js.map