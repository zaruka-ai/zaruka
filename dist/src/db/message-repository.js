export class MessageRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Save a message to persistent history. */
    save(chatId, role, text) {
        this.db.prepare('INSERT INTO messages (chat_id, role, text) VALUES (?, ?, ?)').run(chatId, role, text);
    }
    /** Get the last N messages for a chat (for context window). Returned in chronological order. */
    getRecent(chatId, limit = 20) {
        const rows = this.db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?').all(chatId, limit);
        return rows.reverse(); // chronological order
    }
    /** Full-text search across all messages for a chat. */
    search(chatId, query, limit = 20) {
        return this.db.prepare('SELECT * FROM messages WHERE chat_id = ? AND text LIKE ? ORDER BY id DESC LIMIT ?').all(chatId, `%${query}%`, limit);
    }
    /** Search across ALL chats (for single-user bot). */
    searchAll(query, limit = 20) {
        return this.db.prepare('SELECT * FROM messages WHERE text LIKE ? ORDER BY id DESC LIMIT ?').all(`%${query}%`, limit);
    }
    /** Get message count and date range stats for a chat. */
    getStats(chatId) {
        const stats = this.db.prepare(`
      SELECT
        COUNT(*) as totalMessages,
        SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as userMessages,
        SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) as assistantMessages,
        MIN(created_at) as firstMessage,
        MAX(created_at) as lastMessage
      FROM messages WHERE chat_id = ?
    `).get(chatId);
        return stats;
    }
    /** Get messages from a specific date range. */
    getByDateRange(chatId, from, to, limit = 50) {
        return this.db.prepare('SELECT * FROM messages WHERE chat_id = ? AND created_at >= ? AND created_at <= ? ORDER BY id ASC LIMIT ?').all(chatId, from, to, limit);
    }
    /** Total size of the messages table in bytes (approximate). */
    getDiskUsage() {
        const { rows } = this.db.prepare('SELECT COUNT(*) as rows FROM messages').get();
        const { totalLength } = this.db.prepare('SELECT SUM(LENGTH(text)) as totalLength FROM messages').get();
        return { rows, approxSizeKB: Math.round((totalLength || 0) / 1024) };
    }
}
//# sourceMappingURL=message-repository.js.map