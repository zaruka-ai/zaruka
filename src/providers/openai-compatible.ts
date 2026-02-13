import { OpenAIProvider } from './openai.js';

// OpenAI-compatible provider uses the same SDK with a custom base URL
export class OpenAICompatibleProvider extends OpenAIProvider {
  constructor(apiKey: string, model: string, baseUrl: string) {
    super(apiKey, model, baseUrl);
  }
}
