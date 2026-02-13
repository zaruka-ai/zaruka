export class TaskRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    create(data) {
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
    delete(id) {
        const result = this.db.prepare("UPDATE tasks SET status = 'deleted', updated_at = datetime('now') WHERE id = ?").run(id);
        return result.changes > 0;
    }
    getDueForReminder(timezone) {
        // Get tasks with due dates approaching within reminder_days
        return this.db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'active'
        AND due_date IS NOT NULL
        AND date(due_date) <= date('now', '+' || reminder_days || ' days')
        AND (notified_at IS NULL OR date(notified_at) < date('now'))
      ORDER BY due_date ASC
    `).all();
    }
    markNotified(id) {
        this.db.prepare("UPDATE tasks SET notified_at = datetime('now') WHERE id = ?").run(id);
    }
    count(status) {
        if (status) {
            return this.db.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE status = ?').get(status).cnt;
        }
        return this.db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status != 'deleted'").get().cnt;
    }
}
//# sourceMappingURL=repository.js.map