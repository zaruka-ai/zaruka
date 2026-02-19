import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ZarukaConfig, AiProviderConfig, ResourceThresholds, UserProfile, McpServerConfig } from './types.js';

const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const CONFIG_PATH = join(ZARUKA_DIR, 'config.json');

const DEFAULT_THRESHOLDS: ResourceThresholds = {
  cpuPercent: 90,
  ramPercent: 85,
  diskPercent: 90,
};

export class ConfigManager {
  private config: ZarukaConfig;

  constructor(initial: ZarukaConfig) {
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

  getConfig(): ZarukaConfig {
    return this.config;
  }

  getChatId(): number | undefined {
    return this.config.telegram.chatId;
  }

  setChatId(chatId: number): void {
    this.config.telegram.chatId = chatId;
    this.save();
  }

  getModel(): string {
    return this.config.ai?.model ?? '';
  }

  updateModel(model: string): void {
    if (this.config.ai) {
      this.config.ai.model = model;
      this.save();
    }
  }

  updateAiConfig(ai: ZarukaConfig['ai']): void {
    // Save the current provider config before switching
    if (this.config.ai?.provider) {
      if (!this.config.savedProviders) this.config.savedProviders = {};
      this.config.savedProviders[this.config.ai.provider] = { ...this.config.ai };
    }
    this.config.ai = ai;
    // Also save the new provider config
    if (ai?.provider) {
      if (!this.config.savedProviders) this.config.savedProviders = {};
      this.config.savedProviders[ai.provider] = { ...ai };
    }
    this.save();
  }

  getSavedProvider(provider: string): AiProviderConfig | undefined {
    return this.config.savedProviders?.[provider];
  }

  getProfile(): UserProfile | undefined {
    return this.config.profile;
  }

  updateProfile(profile: Partial<UserProfile>): void {
    this.config.profile = { ...this.config.profile, ...profile };
    this.save();
  }

  updateTimezone(tz: string): void {
    this.config.timezone = tz;
    this.save();
  }

  getLanguage(): string {
    return this.config.language || 'auto';
  }

  updateLanguage(language: string): void {
    this.config.language = language;
    delete this.config.uiTranslations;
    this.save();
  }

  getTranslation(key: string): string | undefined {
    return this.config.uiTranslations?.strings[key];
  }

  getTranslationLanguage(): string | undefined {
    return this.config.uiTranslations?.language;
  }

  updateTranslations(language: string, strings: Record<string, string>): void {
    this.config.uiTranslations = { language, strings };
    this.save();
  }

  clearTranslations(): void {
    delete this.config.uiTranslations;
    this.save();
  }

  getThresholds(): ResourceThresholds {
    return this.config.resourceMonitor?.thresholds ?? { ...DEFAULT_THRESHOLDS };
  }

  updateThreshold(key: keyof ResourceThresholds, value: number): void {
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

  isResourceMonitorEnabled(): boolean {
    return this.config.resourceMonitor?.enabled ?? true;
  }

  setResourceMonitorEnabled(enabled: boolean): void {
    if (!this.config.resourceMonitor) {
      this.config.resourceMonitor = {
        enabled,
        cronExpression: '*/5 * * * *',
        thresholds: { ...DEFAULT_THRESHOLDS },
      };
    } else {
      this.config.resourceMonitor.enabled = enabled;
    }
    this.save();
  }

  getResourceCron(): string {
    return this.config.resourceMonitor?.cronExpression ?? '*/5 * * * *';
  }

  updateAuthToken(authToken: string, refreshToken?: string, expiresAt?: string, baseUrl?: string): void {
    if (this.config.ai) {
      this.config.ai.authToken = authToken;
      if (refreshToken !== undefined) {
        this.config.ai.refreshToken = refreshToken;
      }
      if (expiresAt !== undefined) {
        this.config.ai.tokenExpiresAt = expiresAt;
      }
      if (baseUrl !== undefined) {
        this.config.ai.baseUrl = baseUrl;
      }
      this.save();
    }
  }

  isTokenExpiringSoon(bufferMs = 300_000): boolean {
    const expiresAt = this.config.ai?.tokenExpiresAt;
    // No expiry recorded but we have a refresh token — always refresh to be safe
    if (!expiresAt) return !!this.config.ai?.refreshToken;
    return Date.now() + bufferMs >= new Date(expiresAt).getTime();
  }

  getMcpServers(): Record<string, McpServerConfig> {
    return this.config.mcpServers ?? {};
  }

  addMcpServer(name: string, config: McpServerConfig): void {
    if (!this.config.mcpServers) this.config.mcpServers = {};
    this.config.mcpServers[name] = config;
    this.save();
  }

  removeMcpServer(name: string): boolean {
    if (!this.config.mcpServers?.[name]) return false;
    delete this.config.mcpServers[name];
    if (Object.keys(this.config.mcpServers).length === 0) {
      delete this.config.mcpServers;
    }
    this.save();
    return true;
  }

  /** Wipe all data except the Telegram bot token. Returns a fresh minimal config. */
  resetAll(): ZarukaConfig {
    const fresh: ZarukaConfig = {
      telegram: { botToken: this.config.telegram.botToken },
      timezone: 'UTC',
      reminderCron: '0 9 * * *',
    };
    this.config = { ...fresh };
    this.save();
    return fresh;
  }

  private save(): void {
    if (!existsSync(ZARUKA_DIR)) {
      mkdirSync(ZARUKA_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
  }
}
