import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { tool } from 'ai';
import { z } from 'zod/v4';
export class McpManager {
    clients = new Map();
    /** Cached raw tools per server (populated on initialize). */
    rawTools = new Map();
    async initialize(servers) {
        for (const [name, config] of Object.entries(servers)) {
            try {
                const transport = buildTransport(config);
                const client = await createMCPClient({ transport });
                this.clients.set(name, client);
                // Pre-fetch and cache raw tools
                const tools = await client.tools();
                this.rawTools.set(name, tools);
                console.log(`MCP: connected to "${name}" (${Object.keys(tools).length} tools)`);
            }
            catch (err) {
                console.warn(`MCP: failed to connect to "${name}":`, err instanceof Error ? err.message : err);
            }
        }
    }
    /**
     * Returns meta-tools instead of raw MCP tools.
     * Each connected server gets two tools:
     * - `mcp_{name}` — execute any tool on that server
     * - `mcp_{name}_schema` — get the full parameter schema for a specific tool
     */
    async getTools() {
        const result = {};
        for (const [serverName, tools] of this.rawTools) {
            const safeName = serverName.replace(/[^a-zA-Z0-9_]/g, '_');
            // Build a catalog of tool names + one-line descriptions
            const catalog = Object.entries(tools)
                .map(([name, def]) => {
                const desc = def.description
                    ? def.description.split('\n')[0].slice(0, 120)
                    : 'No description';
                return `- ${name}: ${desc}`;
            })
                .join('\n');
            const toolNames = Object.keys(tools);
            // Meta-tool: execute any tool on this server
            result[`mcp_${safeName}`] = tool({
                description: `Execute a tool on the "${serverName}" MCP server. Available tools:\n${catalog}`,
                inputSchema: z.object({
                    tool_name: z.enum(toolNames)
                        .describe('Name of the tool to call'),
                    args: z.record(z.string(), z.any())
                        .optional()
                        .default({})
                        .describe('Arguments to pass to the tool (as a JSON object)'),
                }),
                execute: async ({ tool_name, args }) => {
                    const targetTool = tools[tool_name];
                    if (!targetTool) {
                        return JSON.stringify({ error: `Tool "${tool_name}" not found on server "${serverName}"` });
                    }
                    try {
                        return await targetTool.execute(args);
                    }
                    catch (err) {
                        return JSON.stringify({
                            error: `Tool "${tool_name}" failed: ${err instanceof Error ? err.message : String(err)}`,
                        });
                    }
                },
            });
            // Schema tool: get full parameter schema for a specific tool
            result[`mcp_${safeName}_schema`] = tool({
                description: `Get the full parameter schema for a specific tool on the "${serverName}" MCP server. `
                    + `Call this when you need to know the exact parameters before calling mcp_${safeName}.`,
                inputSchema: z.object({
                    tool_name: z.enum(toolNames)
                        .describe('Name of the tool to get schema for'),
                }),
                execute: async ({ tool_name }) => {
                    const targetTool = tools[tool_name];
                    if (!targetTool) {
                        return JSON.stringify({ error: `Tool "${tool_name}" not found on server "${serverName}"` });
                    }
                    return JSON.stringify({
                        tool_name,
                        description: targetTool.description ?? 'No description',
                        parameters: targetTool.parameters ?? targetTool.inputSchema ?? 'No schema available',
                    });
                },
            });
        }
        return result;
    }
    getConnectedServers() {
        return [...this.clients.keys()];
    }
    async closeAll() {
        const entries = [...this.clients.entries()];
        this.clients.clear();
        this.rawTools.clear();
        await Promise.allSettled(entries.map(async ([name, client]) => {
            try {
                await client.close();
            }
            catch (err) {
                console.warn(`MCP: error closing "${name}":`, err instanceof Error ? err.message : err);
            }
        }));
    }
}
function buildTransport(config) {
    const type = config.type ?? 'stdio';
    if (type === 'stdio') {
        const c = config;
        return new StdioMCPTransport({
            command: c.command,
            args: c.args,
            env: c.env,
        });
    }
    // http or sse
    const c = config;
    return { type: type, url: c.url, headers: c.headers };
}
//# sourceMappingURL=mcp-manager.js.map