import type Database from 'better-sqlite3';
import type { Task } from '../core/types.js';

export class TaskRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(data: { title: string; description?: string; due_date?: string; source?: string; source_ref?: string }): Task {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (title, description, due_date, source, source_ref)
      VALUES (@title, @description, @due_date, @source, @source_ref)
    `);
    const result = stmt.run({
      title: data.title,
      description: data.description ?? null,
      due_date: data.due_date ?? null,
      source: data.source ?? 'manual',
      source_ref: data.source_ref ?? null,
    });
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Task | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
  }

  list(status?: string): Task[] {
    if (status) {
      return this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC').all(status) as Task[];
    }
    return this.db.prepare('SELECT * FROM tasks WHERE status != ? ORDER BY created_at DESC').all('deleted') as Task[];
  }

  complete(id: number): Task | undefined {
    this.db.prepare("UPDATE tasks SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(id);
    return this.getById(id);
  }

  update(id: number, data: Partial<Pick<Task, 'title' | 'description' | 'due_date' | 'reminder_days'>>): Task | undefined {
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    if (data.title !== undefined) { fields.push('title = @title'); values.title = data.title; }
    if (data.description !== undefined) { fields.push('description = @description'); values.description = data.description; }
    if (data.due_date !== undefined) { fields.push('due_date = @due_date'); values.due_date = data.due_date; }
    if (data.reminder_days !== undefined) { fields.push('reminder_days = @reminder_days'); values.reminder_days = data.reminder_days; }

    if (fields.length === 0) return this.getById(id);

    fields.push("updated_at = datetime('now')");
    this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = @id`).run(values);
    return this.getById(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare("UPDATE tasks SET status = 'deleted', updated_at = datetime('now') WHERE id = ?").run(id);
    return result.changes > 0;
  }

  getDueForReminder(timezone: string): Task[] {
    // Get tasks with due dates approaching within reminder_days
    return this.db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'active'
        AND due_date IS NOT NULL
        AND date(due_date) <= date('now', '+' || reminder_days || ' days')
        AND (notified_at IS NULL OR date(notified_at) < date('now'))
      ORDER BY due_date ASC
    `).all() as Task[];
  }

  markNotified(id: number): void {
    this.db.prepare("UPDATE tasks SET notified_at = datetime('now') WHERE id = ?").run(id);
  }

  count(status?: string): number {
    if (status) {
      return (this.db.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE status = ?').get(status) as { cnt: number }).cnt;
    }
    return (this.db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status != 'deleted'").get() as { cnt: number }).cnt;
  }
}
