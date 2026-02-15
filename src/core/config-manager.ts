import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ZarukaConfig, ResourceThresholds, UserProfile } from './types.js';

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
    this.config.ai = ai;
    this.save();
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

  updateAuthToken(authToken: string, refreshToken?: string, expiresAt?: string): void {
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

  isTokenExpiringSoon(bufferMs = 300_000): boolean {
    const expiresAt = this.config.ai?.tokenExpiresAt;
    if (!expiresAt) return false;
    return Date.now() + bufferMs >= new Date(expiresAt).getTime();
  }

  private save(): void {
    if (!existsSync(ZARUKA_DIR)) {
      mkdirSync(ZARUKA_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
  }
}
