import type { ZarukaConfig, AiProviderConfig, ResourceThresholds, UserProfile } from './types.js';
export declare class ConfigManager {
    private config;
    constructor(initial: ZarukaConfig);
    getConfig(): ZarukaConfig;
    getChatId(): number | undefined;
    setChatId(chatId: number): void;
    getModel(): string;
    updateModel(model: string): void;
    updateAiConfig(ai: ZarukaConfig['ai']): void;
    getSavedProvider(provider: string): AiProviderConfig | undefined;
    getProfile(): UserProfile | undefined;
    updateProfile(profile: Partial<UserProfile>): void;
    updateTimezone(tz: string): void;
    getLanguage(): string;
    updateLanguage(language: string): void;
    getTranslation(key: string): string | undefined;
    getTranslationLanguage(): string | undefined;
    updateTranslations(language: string, strings: Record<string, string>): void;
    clearTranslations(): void;
    getThresholds(): ResourceThresholds;
    updateThreshold(key: keyof ResourceThresholds, value: number): void;
    isResourceMonitorEnabled(): boolean;
    setResourceMonitorEnabled(enabled: boolean): void;
    getResourceCron(): string;
    updateAuthToken(authToken: string, refreshToken?: string, expiresAt?: string): void;
    isTokenExpiringSoon(bufferMs?: number): boolean;
    /** Wipe all data except the Telegram bot token. Returns a fresh minimal config. */
    resetAll(): ZarukaConfig;
    private save;
}
//# sourceMappingURL=config-manager.d.ts.map