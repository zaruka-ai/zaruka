import type Database from 'better-sqlite3';

export interface StoredMessage {
  id: number;
  chat_id: number;
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
  file_id?: string | null;
  file_type?: string | null;
  mime_type?: string | null;
  file_name?: string | null;
}

export interface AttachmentMeta {
  fileId: string;
  fileType: 'photo' | 'document';
  mimeType?: string;
  fileName?: string;
}

export class MessageRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Save a message to persistent history, optionally with file attachment metadata. */
  save(chatId: number, role: 'user' | 'assistant', text: string, attachment?: AttachmentMeta): void {
    if (attachment) {
      this.db.prepare(
        'INSERT INTO messages (chat_id, role, text, file_id, file_type, mime_type, file_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(chatId, role, text, attachment.fileId, attachment.fileType, attachment.mimeType ?? null, attachment.fileName ?? null);
    } else {
      this.db.prepare(
        'INSERT INTO messages (chat_id, role, text) VALUES (?, ?, ?)',
      ).run(chatId, role, text);
    }
  }

  /** Get the last N messages for a chat (for context window). Returned in chronological order. */
  getRecent(chatId: number, limit = 20): StoredMessage[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?',
    ).all(chatId, limit) as StoredMessage[];
    return rows.reverse(); // chronological order
  }

  /** Full-text search across all messages for a chat. */
  search(chatId: number, query: string, limit = 20): StoredMessage[] {
    return this.db.prepare(
      'SELECT * FROM messages WHERE chat_id = ? AND text LIKE ? ORDER BY id DESC LIMIT ?',
    ).all(chatId, `%${query}%`, limit) as StoredMessage[];
  }

  /** Search across ALL chats (for single-user bot). */
  searchAll(query: string, limit = 20): StoredMessage[] {
    return this.db.prepare(
      'SELECT * FROM messages WHERE text LIKE ? ORDER BY id DESC LIMIT ?',
    ).all(`%${query}%`, limit) as StoredMessage[];
  }

  /** Get message count and date range stats for a chat. */
  getStats(chatId: number): { totalMessages: number; userMessages: number; assistantMessages: number; firstMessage: string | null; lastMessage: string | null } {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as totalMessages,
        SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as userMessages,
        SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) as assistantMessages,
        MIN(created_at) as firstMessage,
        MAX(created_at) as lastMessage
      FROM messages WHERE chat_id = ?
    `).get(chatId) as { totalMessages: number; userMessages: number; assistantMessages: number; firstMessage: string | null; lastMessage: string | null };
    return stats;
  }

  /** Get messages from a specific date range. */
  getByDateRange(chatId: number, from: string, to: string, limit = 50): StoredMessage[] {
    return this.db.prepare(
      'SELECT * FROM messages WHERE chat_id = ? AND created_at >= ? AND created_at <= ? ORDER BY id ASC LIMIT ?',
    ).all(chatId, from, to, limit) as StoredMessage[];
  }

  /** Total size of the messages table in bytes (approximate). */
  getDiskUsage(): { rows: number; approxSizeKB: number } {
    const { rows } = this.db.prepare('SELECT COUNT(*) as rows FROM messages').get() as { rows: number };
    const { totalLength } = this.db.prepare('SELECT SUM(LENGTH(text)) as totalLength FROM messages').get() as { totalLength: number | null };
    return { rows, approxSizeKB: Math.round((totalLength || 0) / 1024) };
  }
}
