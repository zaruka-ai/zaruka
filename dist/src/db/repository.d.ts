import type Database from 'better-sqlite3';
import type { Task } from '../core/types.js';
export declare class TaskRepository {
    private db;
    constructor(db: Database.Database);
    create(data: {
        title: string;
        description?: string;
        due_date?: string;
        source?: string;
        source_ref?: string;
    }): Task;
    getById(id: number): Task | undefined;
    list(status?: string): Task[];
    complete(id: number): Task | undefined;
    update(id: number, data: Partial<Pick<Task, 'title' | 'description' | 'due_date' | 'reminder_days'>>): Task | undefined;
    delete(id: number): boolean;
    getDueForReminder(timezone: string): Task[];
    markNotified(id: number): void;
    count(status?: string): number;
}
//# sourceMappingURL=repository.d.ts.map