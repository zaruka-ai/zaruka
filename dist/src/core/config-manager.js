import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const CONFIG_PATH = join(ZARUKA_DIR, 'config.json');
const DEFAULT_THRESHOLDS = {
    cpuPercent: 90,
    ramPercent: 85,
    diskPercent: 90,
};
export class ConfigManager {
    config;
    constructor(initial) {
        this.config = { ...initial };
        // Ensure resource monitor defaults
        if (!this.config.resourceMonitor) {
            this.config.resourceMonitor = {
                enabled: true,
                cronExpression: '*/5 * * * *',
                thresholds: { ...DEFAULT_THRESHOLDS },
            };
        }
    }
    getConfig() {
        return this.config;
    }
    getChatId() {
        return this.config.telegram.chatId;
    }
    setChatId(chatId) {
        this.config.telegram.chatId = chatId;
        this.save();
    }
    getModel() {
        return this.config.ai?.model ?? '';
    }
    updateModel(model) {
        if (this.config.ai) {
            this.config.ai.model = model;
            this.save();
        }
    }
    updateAiConfig(ai) {
        this.config.ai = ai;
        this.save();
    }
    getLanguage() {
        return this.config.language || 'auto';
    }
    updateLanguage(language) {
        this.config.language = language;
        this.save();
    }
    getThresholds() {
        return this.config.resourceMonitor?.thresholds ?? { ...DEFAULT_THRESHOLDS };
    }
    updateThreshold(key, value) {
        if (!this.config.resourceMonitor) {
            this.config.resourceMonitor = {
                enabled: true,
                cronExpression: '*/5 * * * *',
                thresholds: { ...DEFAULT_THRESHOLDS },
            };
        }
        this.config.resourceMonitor.thresholds[key] = value;
        this.save();
    }
    isResourceMonitorEnabled() {
        return this.config.resourceMonitor?.enabled ?? true;
    }
    getResourceCron() {
        return this.config.resourceMonitor?.cronExpression ?? '*/5 * * * *';
    }
    save() {
        if (!existsSync(ZARUKA_DIR)) {
            mkdirSync(ZARUKA_DIR, { recursive: true });
        }
        writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
    }
}
//# sourceMappingURL=config-manager.js.map