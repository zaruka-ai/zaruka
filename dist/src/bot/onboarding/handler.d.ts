import type { ConfigManager } from '../../core/config-manager.js';
import type { AiProvider } from '../../core/types.js';
export type OnboardingStep = 'ask_language' | 'provider' | 'auth_method' | 'api_key' | 'base_url' | 'model' | 'testing';
export type Ctx = any;
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
    /** Skip profile questions — set when changing providers from settings. */
    skipProfile?: boolean;
}
export interface OnboardingDeps {
    configManager: ConfigManager;
    onSetupComplete?: () => Promise<void>;
    /** Called after first-time onboarding completes — triggers the AI greeting. */
    onOnboardingComplete?: (ctx: Ctx) => Promise<void>;
}
export declare class OnboardingHandler {
    state: OnboardingState | null;
    deps: OnboardingDeps;
    constructor(deps: OnboardingDeps, initial?: boolean);
    get active(): boolean;
    reset(): void;
    sendWelcome(ctx: Ctx): Promise<void>;
    handleLanguageSelected(ctx: Ctx, language: string): Promise<void>;
    startProviderChange(ctx: Ctx): Promise<void>;
    handleProviderSelected(ctx: Ctx, provider: AiProvider): Promise<void>;
    handleAuthMethod(ctx: Ctx, method: 'api_key' | 'oauth'): Promise<void>;
    handleModelSelected(ctx: Ctx, model: string): Promise<void>;
    handleShowAllModels(ctx: Ctx): Promise<void>;
    handleBackToProvider(ctx: Ctx): Promise<void>;
    handleRetry(ctx: Ctx): Promise<void>;
    handleText(ctx: Ctx, text: string): Promise<void>;
}
//# sourceMappingURL=handler.d.ts.map