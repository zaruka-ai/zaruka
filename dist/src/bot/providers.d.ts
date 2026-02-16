import { Markup } from 'telegraf';
import type { ZarukaConfig, AiProvider } from '../core/types.js';
/** Human-readable labels for each provider. */
export declare const PROVIDER_LABELS: Record<AiProvider, string>;
/** Known base URLs for providers using OpenAI-compatible protocol. */
export declare const PROVIDER_BASE_URLS: Record<string, string>;
/** API key hints shown during onboarding. */
export declare const PROVIDER_API_KEY_HINTS: Record<string, string>;
/** Providers that support OAuth sign-in (subscription-based). */
export declare const OAUTH_PROVIDERS: Set<AiProvider>;
/** Build the inline keyboard with provider buttons. */
export declare function providerKeyboard(): Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
/** Build inline keyboard listing providers for the settings model flow. */
export declare function settingsProviderKeyboard(currentProvider?: AiProvider): Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
/** Test AI connection with a minimal prompt. */
export declare function testAiConnection(ai: NonNullable<ZarukaConfig['ai']>): Promise<{
    ok: boolean;
    error?: string;
}>;
/** Build a provider-aware rate limit error message. */
export declare function buildRateLimitMessage(provider: AiProvider | undefined, isOAuth: boolean, errorMsg: string): string;
//# sourceMappingURL=providers.d.ts.map