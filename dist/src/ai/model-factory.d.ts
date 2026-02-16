import type { LanguageModel } from 'ai';
import type { ZarukaConfig } from '../core/types.js';
export type AiConfig = NonNullable<ZarukaConfig['ai']>;
/** Create a LanguageModel for the user's chosen model. */
export declare function createModel(ai: AiConfig): LanguageModel;
/**
 * Create a LanguageModel for the best available model from the user's provider.
 * Queries the provider API to find the flagship model dynamically.
 * Falls back to the user's configured model if the API call fails.
 */
export declare function createBestModel(ai: AiConfig): Promise<LanguageModel>;
//# sourceMappingURL=model-factory.d.ts.map