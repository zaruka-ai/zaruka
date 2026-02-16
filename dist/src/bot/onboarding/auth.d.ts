import type { AiProvider } from '../../core/types.js';
import type { OnboardingHandler, Ctx } from './handler.js';
export declare function handleProviderSelected(handler: OnboardingHandler, ctx: Ctx, provider: AiProvider): Promise<void>;
export declare function handleAuthMethod(handler: OnboardingHandler, ctx: Ctx, method: 'api_key' | 'oauth'): Promise<void>;
export declare function handleApiKeyInput(handler: OnboardingHandler, ctx: Ctx, input: string): Promise<void>;
//# sourceMappingURL=auth.d.ts.map