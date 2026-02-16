import type { ConfigManager } from '../core/config-manager.js';
import type { AiProvider } from '../core/types.js';
type OnboardingStep = 'provider' | 'auth_method' | 'api_key' | 'base_url' | 'model' | 'testing' | 'ask_name' | 'ask_city' | 'ask_birthday';
export interface OnboardingState {
    step: OnboardingStep;
    provider?: AiProvider;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    isOAuth?: boolean;
    codeVerifier?: string;
    oauthState?: string;
    refreshToken?: string;
    tokenExpiresIn?: number;
    deviceAuthId?: string;
    deviceUserCode?: string;
    isPolling?: boolean;
    profileName?: string;
    profileCity?: string;
    profileTimezone?: string;
    profileBirthday?: string;
    telegramFirstName?: string;
}
export interface OnboardingDeps {
    configManager: ConfigManager;
    onSetupComplete?: () => Promise<void>;
}
type Ctx = any;
/**
 * Manages the entire onboarding flow: provider selection, auth, model picking, profile.
 */
export declare class OnboardingHandler {
    state: OnboardingState | null;
    private deps;
    constructor(deps: OnboardingDeps, initial?: boolean);
    get active(): boolean;
    reset(): void;
    sendWelcome(ctx: Ctx): Promise<void>;
    startProviderChange(ctx: Ctx): Promise<void>;
    handleProviderSelected(ctx: Ctx, provider: AiProvider): Promise<void>;
    handleAuthMethod(ctx: Ctx, method: 'api_key' | 'oauth'): Promise<void>;
    handleModelSelected(ctx: Ctx, model: string): Promise<void>;
    handleNameConfirm(ctx: Ctx): Promise<void>;
    handleNameChange(ctx: Ctx): Promise<void>;
    handleCitySkip(ctx: Ctx): Promise<void>;
    handleCityType(ctx: Ctx): Promise<void>;
    handleBirthdaySkip(ctx: Ctx): Promise<void>;
    handleRetry(ctx: Ctx): Promise<void>;
    handleLocation(ctx: Ctx, lat: number, lon: number): Promise<void>;
    handleText(ctx: Ctx, text: string): Promise<void>;
    private handleApiKeyInput;
    private buildModelButtons;
    private sendModelSelection;
    handleShowAllModels(ctx: Ctx): Promise<void>;
    handleBackToProvider(ctx: Ctx): Promise<void>;
    private pollDeviceCodeInBackground;
    private finishOnboarding;
    private sendAskCity;
    private sendAskBirthday;
    private completeOnboarding;
}
export {};
//# sourceMappingURL=onboarding.d.ts.map