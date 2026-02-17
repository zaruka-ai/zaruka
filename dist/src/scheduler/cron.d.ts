import type { TaskRepository } from '../db/repository.js';
import type { ConfigManager } from '../core/config-manager.js';
export declare class Scheduler {
    private taskJob;
    private resourceJob;
    private repo;
    private timezone;
    private notifyFn;
    private executeAction;
    private configManager;
    private lastAlerts;
    private static ALERT_COOLDOWN_MS;
    constructor(repo: TaskRepository, timezone: string, notifyFn: (message: string) => Promise<void>, configManager: ConfigManager, executeAction?: (instruction: string) => Promise<string>);
    private checkTasks;
    private checkResources;
    private isOnCooldown;
    start(): void;
    stop(): void;
}
//# sourceMappingURL=cron.d.ts.map