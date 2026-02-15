// Pricing per 1M tokens
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-6': { input: 15.00, output: 75.00 },
  'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5': { input: 0.80, output: 4.00 },
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4-turbo-preview': { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  // Free / self-hosted
  'llama': { input: 0, output: 0 },
  'mistral': { input: 0, output: 0 },
  'mixtral': { input: 0, output: 0 },
  'qwen': { input: 0, output: 0 },
  'deepseek': { input: 0, output: 0 },
  'phi': { input: 0, output: 0 },
  'gemma': { input: 0, output: 0 },
};

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try exact match first
  let pricing = PRICING[model];

  // If not found, try prefix match (e.g., gpt-4o-2024-05-13 -> gpt-4o)
  if (!pricing) {
    const lower = model.toLowerCase();
    for (const [key, value] of Object.entries(PRICING)) {
      if (lower.startsWith(key.toLowerCase())) {
        pricing = value;
        break;
      }
    }
  }

  // Default to zero for unknown models (likely self-hosted)
  if (!pricing) {
    pricing = { input: 0, output: 0 };
  }

  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
