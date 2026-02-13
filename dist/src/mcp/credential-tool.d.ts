import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
/**
 * Load credentials from ~/.zaruka/.env into process.env.
 * Call this on startup before creating the MCP server.
 */
export declare function loadCredentials(): void;
export declare function createCredentialTool(): SdkMcpToolDefinition<any>;
//# sourceMappingURL=credential-tool.d.ts.map