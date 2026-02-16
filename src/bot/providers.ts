import { Markup } from 'telegraf';
import { generateText } from 'ai';
import { createModel } from '../ai/model-factory.js';
import type { ZarukaConfig, AiProvider } from '../core/types.js';

/** Human-readable labels for each provider. */
export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  google: 'Google (Gemini)',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  xai: 'xAI (Grok)',
  'openai-compatible': 'Self-hosted (Ollama, etc.)',
};

/** Known base URLs for providers using OpenAI-compatible protocol. */
export const PROVIDER_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  groq: 'https://api.groq.com/openai/v1',
  xai: 'https://api.x.ai/v1',
};

/** API key hints shown during onboarding. */
export const PROVIDER_API_KEY_HINTS: Record<string, string> = {
  anthropic: 'Send your Anthropic API key (starts with `sk-ant-`).\n\nGet one at: https://console.anthropic.com/settings/keys',
  openai: 'Send your OpenAI API key (starts with `sk-`).\n\nGet one at: https://platform.openai.com/api-keys',
  google: 'Send your Google AI API key.\n\nGet one at: https://aistudio.google.com/apikey',
  deepseek: 'Send your DeepSeek API key.\n\nGet one at: https://platform.deepseek.com/api_keys',
  groq: 'Send your Groq API key.\n\nGet one at: https://console.groq.com/keys',
  xai: 'Send your xAI API key.\n\nGet one at: https://console.x.ai',
};

/** Providers that support OAuth sign-in (subscription-based). */
export const OAUTH_PROVIDERS = new Set<AiProvider>(['anthropic', 'openai']);

/** Build the inline keyboard with provider buttons. */
export function providerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Anthropic (Claude)', 'onboard:anthropic'), Markup.button.callback('OpenAI (GPT)', 'onboard:openai')],
    [Markup.button.callback('Google (Gemini)', 'onboard:google'), Markup.button.callback('DeepSeek', 'onboard:deepseek')],
    [Markup.button.callback('Groq', 'onboard:groq'), Markup.button.callback('xAI (Grok)', 'onboard:xai')],
    [Markup.button.callback('Self-hosted (Ollama, etc.)', 'onboard:openai-compatible')],
  ]);
}

/** Build inline keyboard listing providers for the settings model flow. */
export function settingsProviderKeyboard(currentProvider?: AiProvider) {
  const providers: AiProvider[] = ['anthropic', 'openai', 'google', 'deepseek', 'groq', 'xai', 'openai-compatible'];
  const rows = [];
  for (let i = 0; i < providers.length; i += 2) {
    const row = providers.slice(i, i + 2).map((id) => {
      const check = id === currentProvider ? ' ✓' : '';
      return Markup.button.callback(`${PROVIDER_LABELS[id]}${check}`, `settings:provider:${id}`);
    });
    rows.push(row);
  }
  rows.push([Markup.button.callback('« Back', 'settings:back')]);
  return Markup.inlineKeyboard(rows);
}

/** Extract the most detailed error message from a (possibly wrapped) error chain. */
function extractErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  // Walk the cause chain looking for the richest error info.
  // Vercel AI SDK throws APICallError with responseBody containing the raw API response,
  // while .message is often just the HTTP status text (e.g. "Forbidden").
  let best = err.message;
  let current: unknown = err;
  while (current != null) {
    if (current instanceof Error) {
      // Check for APICallError's responseBody (contains raw API error JSON)
      const apiErr = current as Error & { responseBody?: string; statusCode?: number };
      if (apiErr.responseBody) {
        try {
          const body = JSON.parse(apiErr.responseBody);
          const detail = body?.error?.message || body?.message || body?.error;
          if (typeof detail === 'string' && detail.length > best.length) {
            best = detail;
          }
        } catch {
          // responseBody isn't JSON — use it directly if more detailed
          if (apiErr.responseBody.length > best.length) {
            best = apiErr.responseBody;
          }
        }
      }
      // Also check cause's message
      if (current.message.length > best.length) {
        best = current.message;
      }
      current = current.cause;
    } else {
      break;
    }
  }
  return best;
}

/** Test AI connection with a minimal prompt. */
export async function testAiConnection(ai: NonNullable<ZarukaConfig['ai']>): Promise<{ ok: boolean; error?: string }> {
  try {
    console.log(`testAiConnection: provider=${ai.provider}, model=${ai.model}, hasApiKey=${!!ai.apiKey}, hasAuthToken=${!!ai.authToken}`);

    // ChatGPT OAuth: test with a direct fetch to bypass AI SDK quirks
    if (ai.authToken && (!ai.provider || ai.provider === 'openai')) {
      return await testChatGPTConnection(ai);
    }

    const model = createModel(ai);
    await generateText({
      model,
      prompt: 'Say OK',
      maxOutputTokens: 16,
    });
    return { ok: true };
  } catch (err) {
    const msg = extractErrorMessage(err);
    console.error('testAiConnection failed:', msg);
    return { ok: false, error: msg };
  }
}

async function testChatGPTConnection(ai: NonNullable<ZarukaConfig['ai']>): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ai.authToken}`,
      'Content-Type': 'application/json',
      'version': '1.0.0',
      'OpenAI-Beta': 'responses=experimental',
      'originator': 'codex_cli_rs',
    },
    body: JSON.stringify({
      model: ai.model,
      instructions: 'You are a helpful assistant.',
      input: [{ role: 'user', content: 'Say OK' }],
      store: false,
      stream: true,
      tools: [],
      tool_choice: 'auto',
      parallel_tool_calls: false,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.log(`testChatGPTConnection: status=${resp.status} body=${body.slice(0, 500)}`);
    try {
      const data = JSON.parse(body);
      return { ok: false, error: data?.error?.message || data?.detail || `${resp.status} ${resp.statusText}` };
    } catch {
      return { ok: false, error: body || `${resp.status} ${resp.statusText}` };
    }
  }

  // Streaming response — just consume and discard to confirm it works
  if (resp.body) {
    const reader = resp.body.getReader();
    try { while (!(await reader.read()).done) { /* drain */ } } catch { /* ok */ }
  }
  console.log('testChatGPTConnection: success');
  return { ok: true };
}

/** Build a provider-aware rate limit error message. */
export function buildRateLimitMessage(provider: AiProvider | undefined, isOAuth: boolean, errorMsg: string): string {
  const retryMatch = errorMsg.match(/retry in ([\d.]+)s/i);
  const retrySec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 0;
  const retryHint = retrySec > 0 ? `\nRetry in ~${retrySec}s.` : '';

  switch (provider) {
    case 'anthropic':
      if (isOAuth) {
        return '⚠️ Claude usage limit reached\n\n'
          + 'Your Claude subscription limits have been exceeded.\n'
          + 'Limits reset daily/weekly depending on your plan.\n\n'
          + 'Try again later or upgrade your plan.';
      }
      return '⚠️ Anthropic rate limit reached\n\n'
        + 'Wait a few minutes or check your plan at console.anthropic.com';

    case 'openai':
      return '⚠️ OpenAI rate limit reached\n\n'
        + 'Wait a few minutes or check your plan at platform.openai.com';

    case 'google':
      return '⚠️ Google AI quota exceeded\n\n'
        + 'Free tier has limited requests per day/minute.\n'
        + 'Check limits at ai.google.dev/gemini-api/docs/rate-limits'
        + retryHint;

    case 'deepseek':
      return '⚠️ DeepSeek rate limit reached\n\n'
        + 'Wait a moment and try again.'
        + retryHint;

    case 'groq':
      return '⚠️ Groq rate limit reached\n\n'
        + 'Free tier has limited requests per minute/day.\n'
        + 'Wait a moment and try again.'
        + retryHint;

    case 'xai':
      return '⚠️ xAI rate limit reached\n\n'
        + 'Wait a moment and try again.'
        + retryHint;

    default:
      return '⚠️ Rate limit reached\n\n'
        + 'Too many requests. Wait a moment and try again.'
        + retryHint;
  }
}
