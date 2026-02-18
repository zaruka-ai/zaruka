import { type ToolSet } from 'ai';
import type { McpServerConfig } from '../core/types.js';
export declare class McpManager {
    private clients;
    /** Cached raw tools per server (populated on initialize). */
    private rawTools;
    initialize(servers: Record<string, McpServerConfig>): Promise<void>;
    /**
     * Returns meta-tools instead of raw MCP tools.
     * Each connected server gets two tools:
     * - `mcp_{name}` — execute any tool on that server
     * - `mcp_{name}_schema` — get the full parameter schema for a specific tool
     */
    getTools(): Promise<ToolSet>;
    getConnectedServers(): string[];
    closeAll(): Promise<void>;
}
//# sourceMappingURL=mcp-manager.d.ts.map