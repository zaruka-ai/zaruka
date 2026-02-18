import rrule from 'rrule';
import type Database from 'better-sqlite3';
import type { Task } from '../core/types.js';

const { RRule } = rrule;

/** Map legacy keyword values to RRULE strings for backward compatibility. */
const LEGACY_MAP: Record<string, string> = {
  daily: 'FREQ=DAILY',
  weekly: 'FREQ=WEEKLY',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
};

export function normalizeRecurrence(rec: string): string {
  return LEGACY_MAP[rec] ?? rec;
}

/** Convert a local date+time pair into a "fake UTC" Date for rrule math. */
function localToFakeUtc(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, min, 0));
}

/** Get the current time in a timezone as a "fake UTC" Date for rrule comparison. */
function nowAsFakeUtc(timezone: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return new Date(Date.UTC(
    +get('year'), +get('month') - 1, +get('day'),
    +get('hour'), +get('minute'), +get('second'),
  ));
}

function computeNextOccurrence(
  recurrence: string,
  dueDate: string,
  dueTime: string,
  timezone: string,
): { date: string; time: string } | null {
  const normalized = normalizeRecurrence(recurrence);
  const dtstart = localToFakeUtc(dueDate, dueTime);

  const rule = new RRule({
    ...RRule.parseString(normalized),
    dtstart,
  });

  const now = nowAsFakeUtc(timezone);
  const next = rule.after(now);
  if (!next) return null; // COUNT/UNTIL exhausted

  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  const hh = String(next.getUTCHours()).padStart(2, '0');
  const min = String(next.getUTCMinutes()).padStart(2, '0');

  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

export class TaskRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(data: {
    title: string;
    description?: string;
    due_date?: string;
    due_time?: string;
    recurrence?: string;
    action?: string;
    source?: string;
    source_ref?: string;
  }): Task {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (title, description, due_date, due_time, recurrence, action, source, source_ref)
      VALUES (@title, @description, @due_date, @due_time, @recurrence, @action, @source, @source_ref)
    `);
    const result = stmt.run({
      title: data.title,
      description: data.description ?? null,
      due_date: data.due_date ?? null,
      due_time: data.due_time ?? '12:00',
      recurrence: data.recurrence ?? null,
      action: data.action ?? null,
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

  update(id: number, data: Partial<Pick<Task, 'title' | 'description' | 'due_date' | 'due_time' | 'recurrence' | 'action' | 'reminder_days'>>): Task | undefined {
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    if (data.title !== undefined) { fields.push('title = @title'); values.title = data.title; }
    if (data.description !== undefined) { fields.push('description = @description'); values.description = data.description; }
    if (data.due_date !== undefined) { fields.push('due_date = @due_date'); values.due_date = data.due_date; }
    if (data.due_time !== undefined) { fields.push('due_time = @due_time'); values.due_time = data.due_time; }
    if (data.recurrence !== undefined) { fields.push('recurrence = @recurrence'); values.recurrence = data.recurrence; }
    if (data.action !== undefined) { fields.push('action = @action'); values.action = data.action; }
    if (data.reminder_days !== undefined) { fields.push('reminder_days = @reminder_days'); values.reminder_days = data.reminder_days; }

    if (fields.length === 0) return this.getById(id);

    fields.push("updated_at = datetime('now')");
    this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = @id`).run(values);
    return this.getById(id);
  }

  pause(id: number): Task | undefined {
    this.db.prepare("UPDATE tasks SET status = 'paused', updated_at = datetime('now') WHERE id = ?").run(id);
    return this.getById(id);
  }

  resume(id: number): Task | undefined {
    this.db.prepare("UPDATE tasks SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(id);
    return this.getById(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare("UPDATE tasks SET status = 'deleted', updated_at = datetime('now') WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /** Return active tasks whose date+time has arrived in the given timezone. */
  getDueNow(timezone: string): Task[] {
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now); // YYYY-MM-DD
    const currentTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now); // HH:MM

    return this.db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'active'
        AND due_date IS NOT NULL
        AND due_date = @today
        AND due_time <= @currentTime
      ORDER BY due_time ASC
    `).all({ today, currentTime }) as Task[];
  }

  /** Advance a recurring task to the next occurrence, or complete it if exhausted. */
  advanceRecurrence(id: number, timezone: string): void {
    const task = this.getById(id);
    if (!task || !task.recurrence || !task.due_date) return;

    const next = computeNextOccurrence(task.recurrence, task.due_date, task.due_time, timezone);
    if (next) {
      this.db.prepare(`
        UPDATE tasks SET due_date = @date, due_time = @time, updated_at = datetime('now')
        WHERE id = @id
      `).run({ id, date: next.date, time: next.time });
    } else {
      // COUNT or UNTIL exhausted — auto-complete
      this.complete(id);
    }
  }

  /** Find an active task whose title matches (case-insensitive substring). */
  findActiveByTitle(substring: string): Task | undefined {
    return this.db.prepare(
      "SELECT * FROM tasks WHERE status = 'active' AND title LIKE '%' || @sub || '%' COLLATE NOCASE ORDER BY created_at DESC LIMIT 1",
    ).get({ sub: substring }) as Task | undefined;
  }

  count(status?: string): number {
    if (status) {
      return (this.db.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE status = ?').get(status) as { cnt: number }).cnt;
    }
    return (this.db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status != 'deleted'").get() as { cnt: number }).cnt;
  }
}
