import type { ZarukaConfig, ResourceThresholds, UserProfile } from './types.js';
export declare class ConfigManager {
    private config;
    constructor(initial: ZarukaConfig);
    getConfig(): ZarukaConfig;
    getChatId(): number | undefined;
    setChatId(chatId: number): void;
    getModel(): string;
    updateModel(model: string): void;
    updateAiConfig(ai: ZarukaConfig['ai']): void;
    getProfile(): UserProfile | undefined;
    updateProfile(profile: Partial<UserProfile>): void;
    updateTimezone(tz: string): void;
    getLanguage(): string;
    updateLanguage(language: string): void;
    getThresholds(): ResourceThresholds;
    updateThreshold(key: keyof ResourceThresholds, value: number): void;
    isResourceMonitorEnabled(): boolean;
    setResourceMonitorEnabled(enabled: boolean): void;
    getResourceCron(): string;
    updateAuthToken(authToken: string, refreshToken?: string, expiresAt?: string): void;
    isTokenExpiringSoon(bufferMs?: number): boolean;
    private save;
}
//# sourceMappingURL=config-manager.d.ts.map