import type Database from 'better-sqlite3';
export interface StoredMessage {
    id: number;
    chat_id: number;
    role: 'user' | 'assistant';
    text: string;
    created_at: string;
}
export declare class MessageRepository {
    private db;
    constructor(db: Database.Database);
    /** Save a message to persistent history. */
    save(chatId: number, role: 'user' | 'assistant', text: string): void;
    /** Get the last N messages for a chat (for context window). Returned in chronological order. */
    getRecent(chatId: number, limit?: number): StoredMessage[];
    /** Full-text search across all messages for a chat. */
    search(chatId: number, query: string, limit?: number): StoredMessage[];
    /** Search across ALL chats (for single-user bot). */
    searchAll(query: string, limit?: number): StoredMessage[];
    /** Get message count and date range stats for a chat. */
    getStats(chatId: number): {
        totalMessages: number;
        userMessages: number;
        assistantMessages: number;
        firstMessage: string | null;
        lastMessage: string | null;
    };
    /** Get messages from a specific date range. */
    getByDateRange(chatId: number, from: string, to: string, limit?: number): StoredMessage[];
    /** Total size of the messages table in bytes (approximate). */
    getDiskUsage(): {
        rows: number;
        approxSizeKB: number;
    };
}
//# sourceMappingURL=message-repository.d.ts.map