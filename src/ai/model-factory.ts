import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { ZarukaConfig } from '../core/types.js';

type AiConfig = NonNullable<ZarukaConfig['ai']>;

const BEST_MODELS: Record<string, string> = {
  anthropic: 'claude-opus-4-6',
  openai: 'gpt-4o',
};

export function createModel(ai: AiConfig): LanguageModel {
  if (ai.provider === 'anthropic') {
    const provider = createAnthropic({
      ...(ai.apiKey ? { apiKey: ai.apiKey } : {}),
      ...(ai.authToken ? { headers: { Authorization: `Bearer ${ai.authToken}` } } : {}),
    });
    return provider(ai.model);
  }

  // OpenAI and OpenAI-compatible
  const provider = createOpenAI({
    apiKey: ai.apiKey || 'no-key',
    ...(ai.baseUrl ? { baseURL: ai.baseUrl } : {}),
  });
  return provider(ai.model);
}

export function createBestModel(ai: AiConfig): LanguageModel {
  const bestModel = BEST_MODELS[ai.provider] ?? ai.model;

  if (ai.provider === 'anthropic') {
    const provider = createAnthropic({
      ...(ai.apiKey ? { apiKey: ai.apiKey } : {}),
      ...(ai.authToken ? { headers: { Authorization: `Bearer ${ai.authToken}` } } : {}),
    });
    return provider(bestModel);
  }

  const provider = createOpenAI({
    apiKey: ai.apiKey || 'no-key',
    ...(ai.baseUrl ? { baseURL: ai.baseUrl } : {}),
  });
  return provider(bestModel);
}
