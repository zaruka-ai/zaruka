import type Database from 'better-sqlite3';
import type { Task } from '../core/types.js';
export declare class TaskRepository {
    private db;
    constructor(db: Database.Database);
    create(data: {
        title: string;
        description?: string;
        due_date?: string;
        due_time?: string;
        recurrence?: string;
        action?: string;
        source?: string;
        source_ref?: string;
    }): Task;
    getById(id: number): Task | undefined;
    list(status?: string): Task[];
    complete(id: number): Task | undefined;
    update(id: number, data: Partial<Pick<Task, 'title' | 'description' | 'due_date' | 'due_time' | 'recurrence' | 'action' | 'reminder_days'>>): Task | undefined;
    pause(id: number): Task | undefined;
    resume(id: number): Task | undefined;
    delete(id: number): boolean;
    /** Return active tasks whose date+time has arrived in the given timezone. */
    getDueNow(timezone: string): Task[];
    /** Advance a recurring task to the next occurrence date. */
    advanceRecurrence(id: number): void;
    count(status?: string): number;
}
//# sourceMappingURL=repository.d.ts.map