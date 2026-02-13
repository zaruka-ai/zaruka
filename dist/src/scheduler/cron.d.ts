import type { TaskRepository } from '../db/repository.js';
import type { ConfigManager } from '../core/config-manager.js';
export declare class Scheduler {
    private reminderJob;
    private resourceJob;
    private repo;
    private timezone;
    private notifyFn;
    private configManager;
    private lastAlerts;
    private static ALERT_COOLDOWN_MS;
    constructor(repo: TaskRepository, timezone: string, reminderCron: string, notifyFn: (message: string) => Promise<void>, configManager: ConfigManager);
    private checkReminders;
    private checkResources;
    private isOnCooldown;
    start(): void;
    stop(): void;
}
//# sourceMappingURL=cron.d.ts.map