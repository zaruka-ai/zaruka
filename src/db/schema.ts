import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const DB_PATH = join(ZARUKA_DIR, 'data.db');

export function getDb(): Database.Database {
  if (!existsSync(ZARUKA_DIR)) {
    mkdirSync(ZARUKA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'active',
      source TEXT DEFAULT 'manual',
      source_ref TEXT,
      reminder_days INTEGER DEFAULT 1,
      notified_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0,
      UNIQUE(date, model)
    );

    CREATE INDEX IF NOT EXISTS idx_api_usage_date ON api_usage(date);
  `);

  // Migrate: add new task columns (due_time, recurrence, action)
  const cols = db.prepare("PRAGMA table_info('tasks')").all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('due_time')) db.exec("ALTER TABLE tasks ADD COLUMN due_time TEXT DEFAULT '12:00'");
  if (!colNames.has('recurrence')) db.exec('ALTER TABLE tasks ADD COLUMN recurrence TEXT');
  if (!colNames.has('action')) db.exec('ALTER TABLE tasks ADD COLUMN action TEXT');

  // Migrate: add file attachment columns to messages
  const msgCols = db.prepare("PRAGMA table_info('messages')").all() as { name: string }[];
  const msgColNames = new Set(msgCols.map((c) => c.name));
  if (!msgColNames.has('file_id')) db.exec('ALTER TABLE messages ADD COLUMN file_id TEXT');
  if (!msgColNames.has('file_type')) db.exec('ALTER TABLE messages ADD COLUMN file_type TEXT');
  if (!msgColNames.has('mime_type')) db.exec('ALTER TABLE messages ADD COLUMN mime_type TEXT');
  if (!msgColNames.has('file_name')) db.exec('ALTER TABLE messages ADD COLUMN file_name TEXT');

  return db;
}
