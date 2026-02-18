import cron from 'node-cron';
import { getResourceSnapshot, formatResourceReport } from '../monitor/resources.js';
export class Scheduler {
    taskJob = null;
    resourceJob = null;
    repo;
    timezone;
    notifyFn;
    executeAction;
    configManager;
    lastAlerts = new Map(); // resource → last alert timestamp
    static ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
    constructor(repo, timezone, notifyFn, configManager, executeAction) {
        this.repo = repo;
        this.timezone = timezone;
        this.notifyFn = notifyFn;
        this.configManager = configManager;
        this.executeAction = executeAction ?? null;
        // Check tasks every minute
        this.taskJob = cron.schedule('* * * * *', () => {
            this.checkTasks().catch(console.error);
        }, { timezone });
        // Resource monitoring cron
        if (this.configManager.isResourceMonitorEnabled()) {
            const resourceCron = this.configManager.getResourceCron();
            this.resourceJob = cron.schedule(resourceCron, () => {
                this.checkResources().catch(console.error);
            }, { timezone });
        }
    }
    async checkTasks() {
        const tasks = this.repo.getDueNow(this.timezone);
        if (tasks.length === 0)
            return;
        for (const task of tasks) {
            try {
                if (task.action && this.executeAction) {
                    // Action task — run AI with the instruction and send result
                    const result = await this.executeAction(task.action);
                    const message = `🤖 [${task.title}]\n\n${result}`;
                    await this.notifyFn(message);
                }
                else {
                    // Simple reminder
                    const due = task.due_date ? ` (${task.due_date} ${task.due_time})` : '';
                    const desc = task.description ? `\n${task.description}` : '';
                    await this.notifyFn(`⏰ ${task.title}${due}${desc}`);
                }
            }
            catch (err) {
                console.error(`Scheduler: error processing task #${task.id}:`, err);
            }
            // Advance recurring tasks or complete one-time tasks
            if (task.recurrence) {
                this.repo.advanceRecurrence(task.id, this.timezone);
            }
            else {
                this.repo.complete(task.id);
            }
        }
    }
    async checkResources() {
        if (!this.configManager.isResourceMonitorEnabled())
            return;
        const snapshot = await getResourceSnapshot();
        const thresholds = this.configManager.getThresholds();
        const alerts = [];
        const now = Date.now();
        // Check CPU
        if (snapshot.cpu.usagePercent >= thresholds.cpuPercent && !this.isOnCooldown('cpu', now)) {
            alerts.push(`⚠️ CPU usage at ${snapshot.cpu.usagePercent}% (threshold: ${thresholds.cpuPercent}%)`);
            this.lastAlerts.set('cpu', now);
        }
        // Check RAM (use effective usage that includes swap)
        const ramUsageToCheck = snapshot.ram.effectiveUsagePercent;
        if (ramUsageToCheck >= thresholds.ramPercent && !this.isOnCooldown('ram', now)) {
            let ramMessage = `⚠️ RAM usage at ${snapshot.ram.usagePercent}%`;
            if (snapshot.ram.swap && snapshot.ram.swap.totalGB > 0) {
                ramMessage += ` + Swap ${snapshot.ram.swap.usedGB}/${snapshot.ram.swap.totalGB} GB`;
                ramMessage += ` (effective: ${ramUsageToCheck}%, threshold: ${thresholds.ramPercent}%)`;
            }
            else {
                ramMessage += ` (${snapshot.ram.usedGB}/${snapshot.ram.totalGB} GB, threshold: ${thresholds.ramPercent}%)`;
            }
            alerts.push(ramMessage);
            this.lastAlerts.set('ram', now);
        }
        // Check Disk
        if (snapshot.disk.usagePercent >= thresholds.diskPercent && !this.isOnCooldown('disk', now)) {
            alerts.push(`⚠️ Disk usage at ${snapshot.disk.usagePercent}% (${snapshot.disk.usedGB}/${snapshot.disk.totalGB} GB, threshold: ${thresholds.diskPercent}%)`);
            this.lastAlerts.set('disk', now);
        }
        if (alerts.length > 0) {
            const message = '🚨 Resource Alert\n\n' + alerts.join('\n') + '\n\n' + formatResourceReport(snapshot);
            await this.notifyFn(message);
        }
    }
    isOnCooldown(resource, now) {
        const lastAlert = this.lastAlerts.get(resource);
        if (!lastAlert)
            return false;
        return now - lastAlert < Scheduler.ALERT_COOLDOWN_MS;
    }
    start() {
        this.taskJob?.start();
        this.resourceJob?.start();
    }
    stop() {
        this.taskJob?.stop();
        this.resourceJob?.stop();
    }
}
//# sourceMappingURL=cron.js.map