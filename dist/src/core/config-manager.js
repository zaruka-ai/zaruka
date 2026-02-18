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
        // Save the current provider config before switching
        if (this.config.ai?.provider) {
            if (!this.config.savedProviders)
                this.config.savedProviders = {};
            this.config.savedProviders[this.config.ai.provider] = { ...this.config.ai };
        }
        this.config.ai = ai;
        // Also save the new provider config
        if (ai?.provider) {
            if (!this.config.savedProviders)
                this.config.savedProviders = {};
            this.config.savedProviders[ai.provider] = { ...ai };
        }
        this.save();
    }
    getSavedProvider(provider) {
        return this.config.savedProviders?.[provider];
    }
    getProfile() {
        return this.config.profile;
    }
    updateProfile(profile) {
        this.config.profile = { ...this.config.profile, ...profile };
        this.save();
    }
    updateTimezone(tz) {
        this.config.timezone = tz;
        this.save();
    }
    getLanguage() {
        return this.config.language || 'auto';
    }
    updateLanguage(language) {
        this.config.language = language;
        delete this.config.uiTranslations;
        this.save();
    }
    getTranslation(key) {
        return this.config.uiTranslations?.strings[key];
    }
    getTranslationLanguage() {
        return this.config.uiTranslations?.language;
    }
    updateTranslations(language, strings) {
        this.config.uiTranslations = { language, strings };
        this.save();
    }
    clearTranslations() {
        delete this.config.uiTranslations;
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
    setResourceMonitorEnabled(enabled) {
        if (!this.config.resourceMonitor) {
            this.config.resourceMonitor = {
                enabled,
                cronExpression: '*/5 * * * *',
                thresholds: { ...DEFAULT_THRESHOLDS },
            };
        }
        else {
            this.config.resourceMonitor.enabled = enabled;
        }
        this.save();
    }
    getResourceCron() {
        return this.config.resourceMonitor?.cronExpression ?? '*/5 * * * *';
    }
    updateAuthToken(authToken, refreshToken, expiresAt) {
        if (this.config.ai) {
            this.config.ai.authToken = authToken;
            if (refreshToken !== undefined) {
                this.config.ai.refreshToken = refreshToken;
            }
            if (expiresAt !== undefined) {
                this.config.ai.tokenExpiresAt = expiresAt;
            }
            this.save();
        }
    }
    isTokenExpiringSoon(bufferMs = 300_000) {
        const expiresAt = this.config.ai?.tokenExpiresAt;
        // No expiry recorded but we have a refresh token — always refresh to be safe
        if (!expiresAt)
            return !!this.config.ai?.refreshToken;
        return Date.now() + bufferMs >= new Date(expiresAt).getTime();
    }
    getMcpServers() {
        return this.config.mcpServers ?? {};
    }
    addMcpServer(name, config) {
        if (!this.config.mcpServers)
            this.config.mcpServers = {};
        this.config.mcpServers[name] = config;
        this.save();
    }
    removeMcpServer(name) {
        if (!this.config.mcpServers?.[name])
            return false;
        delete this.config.mcpServers[name];
        if (Object.keys(this.config.mcpServers).length === 0) {
            delete this.config.mcpServers;
        }
        this.save();
        return true;
    }
    /** Wipe all data except the Telegram bot token. Returns a fresh minimal config. */
    resetAll() {
        const fresh = {
            telegram: { botToken: this.config.telegram.botToken },
            timezone: 'UTC',
            reminderCron: '0 9 * * *',
        };
        this.config = { ...fresh };
        this.save();
        return fresh;
    }
    save() {
        if (!existsSync(ZARUKA_DIR)) {
            mkdirSync(ZARUKA_DIR, { recursive: true });
        }
        writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
    }
}
//# sourceMappingURL=config-manager.js.map