function computeNextDate(dueDate, recurrence) {
    const date = new Date(dueDate + 'T00:00:00');
    switch (recurrence) {
        case 'daily':
            date.setDate(date.getDate() + 1);
            break;
        case 'weekly':
            date.setDate(date.getDate() + 7);
            break;
        case 'monthly':
            date.setMonth(date.getMonth() + 1);
            break;
        case 'yearly':
            date.setFullYear(date.getFullYear() + 1);
            break;
        default:
            // Unknown recurrence — advance by 1 day as fallback
            date.setDate(date.getDate() + 1);
    }
    return date.toISOString().split('T')[0];
}
export class TaskRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    create(data) {
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
        return this.getById(result.lastInsertRowid);
    }
    getById(id) {
        return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    }
    list(status) {
        if (status) {
            return this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC').all(status);
        }
        return this.db.prepare('SELECT * FROM tasks WHERE status != ? ORDER BY created_at DESC').all('deleted');
    }
    complete(id) {
        this.db.prepare("UPDATE tasks SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(id);
        return this.getById(id);
    }
    update(id, data) {
        const fields = [];
        const values = { id };
        if (data.title !== undefined) {
            fields.push('title = @title');
            values.title = data.title;
        }
        if (data.description !== undefined) {
            fields.push('description = @description');
            values.description = data.description;
        }
        if (data.due_date !== undefined) {
            fields.push('due_date = @due_date');
            values.due_date = data.due_date;
        }
        if (data.due_time !== undefined) {
            fields.push('due_time = @due_time');
            values.due_time = data.due_time;
        }
        if (data.recurrence !== undefined) {
            fields.push('recurrence = @recurrence');
            values.recurrence = data.recurrence;
        }
        if (data.action !== undefined) {
            fields.push('action = @action');
            values.action = data.action;
        }
        if (data.reminder_days !== undefined) {
            fields.push('reminder_days = @reminder_days');
            values.reminder_days = data.reminder_days;
        }
        if (fields.length === 0)
            return this.getById(id);
        fields.push("updated_at = datetime('now')");
        this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = @id`).run(values);
        return this.getById(id);
    }
    pause(id) {
        this.db.prepare("UPDATE tasks SET status = 'paused', updated_at = datetime('now') WHERE id = ?").run(id);
        return this.getById(id);
    }
    resume(id) {
        this.db.prepare("UPDATE tasks SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(id);
        return this.getById(id);
    }
    delete(id) {
        const result = this.db.prepare("UPDATE tasks SET status = 'deleted', updated_at = datetime('now') WHERE id = ?").run(id);
        return result.changes > 0;
    }
    /** Return active tasks whose date+time has arrived in the given timezone. */
    getDueNow(timezone) {
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
    `).all({ today, currentTime });
    }
    /** Advance a recurring task to the next occurrence date. */
    advanceRecurrence(id) {
        const task = this.getById(id);
        if (!task || !task.recurrence || !task.due_date)
            return;
        const nextDate = computeNextDate(task.due_date, task.recurrence);
        this.db.prepare(`
      UPDATE tasks SET due_date = @nextDate, updated_at = datetime('now')
      WHERE id = @id
    `).run({ id, nextDate });
    }
    /** Find an active task whose title matches (case-insensitive substring). */
    findActiveByTitle(substring) {
        return this.db.prepare("SELECT * FROM tasks WHERE status = 'active' AND title LIKE '%' || @sub || '%' COLLATE NOCASE ORDER BY created_at DESC LIMIT 1").get({ sub: substring });
    }
    count(status) {
        if (status) {
            return this.db.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE status = ?').get(status).cnt;
        }
        return this.db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status != 'deleted'").get().cnt;
    }
}
//# sourceMappingURL=repository.js.map