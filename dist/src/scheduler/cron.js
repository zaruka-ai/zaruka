import cron from 'node-cron';
import { getResourceSnapshot, formatResourceReport } from '../monitor/resources.js';
export class Scheduler {
    reminderJob = null;
    resourceJob = null;
    repo;
    timezone;
    notifyFn;
    configManager;
    lastAlerts = new Map(); // resource → last alert timestamp
    static ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
    constructor(repo, timezone, reminderCron, notifyFn, configManager) {
        this.repo = repo;
        this.timezone = timezone;
        this.notifyFn = notifyFn;
        this.configManager = configManager;
        // Task reminder cron
        this.reminderJob = cron.schedule(reminderCron, () => {
            this.checkReminders().catch(console.error);
        }, { timezone });
        // Resource monitoring cron
        if (this.configManager.isResourceMonitorEnabled()) {
            const resourceCron = this.configManager.getResourceCron();
            this.resourceJob = cron.schedule(resourceCron, () => {
                this.checkResources().catch(console.error);
            }, { timezone });
        }
    }
    async checkReminders() {
        const tasks = this.repo.getDueForReminder(this.timezone);
        if (tasks.length === 0)
            return;
        const lines = tasks.map(t => {
            const due = t.due_date ? ` (due: ${t.due_date})` : '';
            return `- ${t.title}${due}`;
        });
        const message = `⏰ Reminder! You have ${tasks.length} upcoming task(s):\n\n${lines.join('\n')}`;
        await this.notifyFn(message);
        for (const task of tasks) {
            this.repo.markNotified(task.id);
        }
    }
    async checkResources() {
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
        this.reminderJob?.start();
        this.resourceJob?.start();
    }
    stop() {
        this.reminderJob?.stop();
        this.resourceJob?.stop();
    }
}
//# sourceMappingURL=cron.js.map