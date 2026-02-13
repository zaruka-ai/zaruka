import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { TaskRepository } from '../db/repository.js';
import type { MessageRepository } from '../db/message-repository.js';
export interface ZarukaMcpOptions {
    taskRepo: TaskRepository;
    messageRepo: MessageRepository;
    skillsDir: string;
    authToken?: string;
}
export declare function createZarukaMcpServer(opts: ZarukaMcpOptions): Promise<McpSdkServerConfigWithInstance>;
//# sourceMappingURL=zaruka-mcp-server.d.ts.map