import { OpenAIProvider } from './openai.js';
// OpenAI-compatible provider uses the same SDK with a custom base URL
export class OpenAICompatibleProvider extends OpenAIProvider {
    constructor(apiKey, model, baseUrl, onUsage) {
        super(apiKey, model, baseUrl, onUsage);
    }
}
//# sourceMappingURL=openai-compatible.js.map