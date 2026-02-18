import { tool } from 'ai';
import { z } from 'zod/v4';
export function createMcpManagementTools(configManager, rebuildRef) {
    return {
        add_mcp_server: tool({
            description: 'Add (or update) an MCP server. After saving, the assistant reconnects to all MCP servers automatically. '
                + 'For stdio servers provide command/args. For remote servers provide type ("http" or "sse") and url.',
            inputSchema: z.object({
                name: z.string().describe('Unique server name (e.g. "filesystem", "github")'),
                command: z.string().optional().describe('Command to run for stdio servers (e.g. "npx")'),
                args: z.array(z.string()).optional().describe('Arguments for the command'),
                env: z.record(z.string(), z.string()).optional().describe('Environment variables for stdio servers'),
                type: z.enum(['http', 'sse']).optional().describe('Transport type for remote servers'),
                url: z.string().optional().describe('URL for remote (http/sse) servers'),
                headers: z.record(z.string(), z.string()).optional().describe('HTTP headers for remote servers'),
            }),
            execute: async (args) => {
                let config;
                if (args.type === 'http' || args.type === 'sse') {
                    if (!args.url)
                        return JSON.stringify({ error: 'url is required for http/sse servers' });
                    config = { type: args.type, url: args.url, headers: args.headers };
                }
                else {
                    if (!args.command)
                        return JSON.stringify({ error: 'command is required for stdio servers' });
                    config = { command: args.command, args: args.args, env: args.env };
                }
                configManager.addMcpServer(args.name, config);
                try {
                    if (rebuildRef.current)
                        await rebuildRef.current();
                }
                catch (err) {
                    return JSON.stringify({
                        success: true,
                        warning: `Server "${args.name}" saved but reconnection failed: ${err instanceof Error ? err.message : err}. It will retry on next restart.`,
                    });
                }
                return JSON.stringify({ success: true, message: `MCP server "${args.name}" added and connected.` });
            },
        }),
        remove_mcp_server: tool({
            description: 'Remove an MCP server by name. Disconnects and removes it from config.',
            inputSchema: z.object({
                name: z.string().describe('Name of the MCP server to remove'),
            }),
            execute: async (args) => {
                const removed = configManager.removeMcpServer(args.name);
                if (!removed)
                    return JSON.stringify({ error: `MCP server "${args.name}" not found` });
                try {
                    if (rebuildRef.current)
                        await rebuildRef.current();
                }
                catch { /* non-fatal */ }
                return JSON.stringify({ success: true, message: `MCP server "${args.name}" removed.` });
            },
        }),
        list_mcp_servers: tool({
            description: 'List all configured MCP servers with their connection type.',
            inputSchema: z.object({}),
            execute: async () => {
                const servers = configManager.getMcpServers();
                const entries = Object.entries(servers);
                if (entries.length === 0) {
                    return JSON.stringify({ servers: [], message: 'No MCP servers configured.' });
                }
                return JSON.stringify({
                    servers: entries.map(([name, cfg]) => ({
                        name,
                        type: cfg.type ?? 'stdio',
                        ...(cfg.type === 'http' || cfg.type === 'sse' ? { url: cfg.url } : { command: cfg.command }),
                    })),
                });
            },
        }),
        search_mcp_servers: tool({
            description: 'Search the official MCP server registry to find servers by keyword. '
                + 'Use this when the user asks to find or install an MCP server, or when you think an MCP server could help with a task.',
            inputSchema: z.object({
                query: z.string().describe('Search keyword (e.g. "github", "filesystem", "notion", "slack")'),
            }),
            execute: async ({ query }) => {
                try {
                    const url = `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(query)}&limit=10`;
                    const res = await fetch(url, {
                        headers: { 'Accept': 'application/json' },
                        signal: AbortSignal.timeout(15_000),
                    });
                    if (!res.ok) {
                        return JSON.stringify({ error: `Registry returned ${res.status}. Try web_search as a fallback.` });
                    }
                    const data = await res.json();
                    const servers = data.servers ?? [];
                    if (servers.length === 0) {
                        return JSON.stringify({ results: [], message: `No MCP servers found for "${query}". Try different keywords or use web_search.` });
                    }
                    const results = servers.map((s) => {
                        const npmPkg = s.packages?.find((p) => p.registry_type === 'npm');
                        const anyPkg = npmPkg ?? s.packages?.[0];
                        const entry = {
                            name: s.name,
                            description: s.description,
                            version: s.version,
                        };
                        if (npmPkg) {
                            entry.install = { type: 'stdio', command: 'npx', args: ['-y', npmPkg.name ?? npmPkg.identifier ?? ''] };
                        }
                        else if (anyPkg) {
                            entry.package = { registry: anyPkg.registry_type, name: anyPkg.name ?? anyPkg.identifier };
                        }
                        if (s.remotes && s.remotes.length > 0) {
                            entry.remotes = s.remotes.map((r) => ({ type: r.transport_type, url: r.url }));
                        }
                        const repoUrl = typeof s.repository === 'string' ? s.repository : s.repository?.url;
                        if (repoUrl)
                            entry.repository = repoUrl;
                        return entry;
                    });
                    return JSON.stringify({ results });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    return JSON.stringify({ error: `Failed to search MCP registry: ${msg}. Try web_search as a fallback.` });
                }
            },
        }),
    };
}
//# sourceMappingURL=mcp-tools.js.map