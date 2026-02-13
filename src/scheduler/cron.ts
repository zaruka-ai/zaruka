import cron from 'node-cron';
import type { TaskRepository } from '../db/repository.js';

export class Scheduler {
  private job: cron.ScheduledTask | null = null;
  private repo: TaskRepository;
  private timezone: string;
  private notifyFn: (message: string) => Promise<void>;

  constructor(
    repo: TaskRepository,
    timezone: string,
    cronExpression: string,
    notifyFn: (message: string) => Promise<void>,
  ) {
    this.repo = repo;
    this.timezone = timezone;
    this.notifyFn = notifyFn;

    this.job = cron.schedule(cronExpression, () => {
      this.checkReminders().catch(console.error);
    }, { timezone });
  }

  private async checkReminders(): Promise<void> {
    const tasks = this.repo.getDueForReminder(this.timezone);
    if (tasks.length === 0) return;

    const lines = tasks.map(t => {
      const due = t.due_date ? ` (due: ${t.due_date})` : '';
      return `- ${t.title}${due}`;
    });

    const message = `Reminder! You have ${tasks.length} upcoming task(s):\n\n${lines.join('\n')}`;

    await this.notifyFn(message);

    for (const task of tasks) {
      this.repo.markNotified(task.id);
    }
  }

  start(): void {
    this.job?.start();
  }

  stop(): void {
    this.job?.stop();
  }
}
