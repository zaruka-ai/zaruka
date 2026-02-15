import { Telegraf, Markup } from 'telegraf';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Assistant } from '../core/assistant.js';
import type { ChatMessage } from '../providers/anthropic.js';
import type { MessageRepository } from '../db/message-repository.js';
import type { ConfigManager } from '../core/config-manager.js';
import type { UsageRepository } from '../db/usage-repository.js';
import { fmtNum } from '../db/usage-repository.js';
import type { ZarukaConfig } from '../core/types.js';
import { getResourceSnapshot, formatResourceReport } from '../monitor/resources.js';
import {
  generatePKCE, buildAuthUrl, extractAuthCode, exchangeCodeForTokens,
  requestDeviceCode, pollDeviceToken,
  ANTHROPIC_OAUTH, OPENAI_OAUTH,
} from '../auth/oauth.js';

export type Transcriber = (fileUrl: string) => Promise<string>;

type OnboardingStep = 'provider' | 'auth_method' | 'api_key' | 'base_url' | 'model' | 'testing' | 'ask_name' | 'ask_city' | 'ask_birthday';

interface OnboardingState {
  step: OnboardingStep;
  provider?: 'anthropic' | 'openai' | 'openai-compatible';
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

async function testAiConnection(ai: NonNullable<ZarukaConfig['ai']>): Promise<{ ok: boolean; error?: string }> {
  try {
    if (ai.provider === 'anthropic' && ai.authToken) {
      // OAuth token — use Claude Code SDK (goes through claude.ai, not api.anthropic.com)
      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;
      cleanEnv.CLAUDE_CODE_OAUTH_TOKEN = ai.authToken;
      let gotSuccess = false;
      try {
        const conversation = query({
          prompt: 'Say hi',
          options: {
            model: ai.model,
            maxTurns: 1,
            tools: [],
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
          },
        });
        for await (const msg of conversation) {
          console.log('[testAiConnection] msg type=%s subtype=%s', msg.type, (msg as Record<string, unknown>).subtype);
          if (msg.type === 'result') {
            const r = msg as Record<string, unknown>;
            if (r.subtype === 'success') {
              gotSuccess = true;
            } else {
              const errDetail = r.error || r.result || JSON.stringify(r);
              console.log('[testAiConnection] non-success result:', errDetail);
              return { ok: false, error: `${r.subtype}: ${errDetail}` };
            }
          }
        }
        return { ok: true };
      } catch (sdkErr) {
        // The SDK throws when the child process exits with non-zero code,
        // even after a successful result. Ignore if we already got success.
        console.log('[testAiConnection] SDK threw, gotSuccess=%s, error=%s', gotSuccess, sdkErr instanceof Error ? sdkErr.message : String(sdkErr));
        if (gotSuccess) return { ok: true };
        const msg = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
        return { ok: false, error: msg };
      }
    }

    if (ai.provider === 'anthropic') {
      // API key — use Anthropic SDK directly
      const client = new Anthropic({ apiKey: ai.apiKey });
      await client.messages.create({
        model: ai.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Say hi' }],
      });
      return { ok: true };
    }

    // OpenAI / OpenAI-compatible
    const key = ai.apiKey || ai.authToken;
    const client = new OpenAI({
      apiKey: key || 'no-key',
      ...(ai.baseUrl ? { baseURL: ai.baseUrl } : {}),
    });
    await client.chat.completions.create({
      model: ai.model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Say hi' }],
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Detect language from text using Unicode script analysis.
 * Returns language name or null if ambiguous (numbers, links, etc.)
 */
function detectLanguage(text: string): string | null {
  // Strip URLs, numbers, punctuation for cleaner detection
  const clean = text.replace(/https?:\/\/\S+/g, '').replace(/[0-9\s\p{P}\p{S}]/gu, '');
  if (clean.length < 3) return null;

  const cyrillic = (clean.match(/[\u0400-\u04FF]/g) || []).length;
  const latin = (clean.match(/[a-zA-Z]/g) || []).length;
  const chinese = (clean.match(/[\u4E00-\u9FFF]/g) || []).length;
  const japanese = (clean.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  const arabic = (clean.match(/[\u0600-\u06FF]/g) || []).length;

  const max = Math.max(cyrillic, latin, chinese, japanese, arabic);
  if (max < 2) return null;

  if (cyrillic === max) return 'Russian';
  if (chinese === max) return 'Chinese';
  if (japanese === max) return 'Japanese';
  if (arabic === max) return 'Arabic';
  if (latin === max) return 'English';
  return null;
}

// Birthday parsing: supports DD.MM, DD/MM, DD-MM, "DD month", "month DD"
// Month names in English (full + abbreviated) and Russian (nominative + genitive)
const MONTHS_MAP: Record<string, number> = {
  // English full
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  // English abbreviated
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  // Russian nominative
  'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4, 'май': 5, 'июнь': 6,
  'июль': 7, 'август': 8, 'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12,
  // Russian genitive
  'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
  'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
};

function parseBirthday(text: string): string | null {
  const trimmed = text.trim().toLowerCase();

  // DD.MM, DD/MM, DD-MM
  const numMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (numMatch) {
    const day = parseInt(numMatch[1], 10);
    const month = parseInt(numMatch[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // "DD month" or "month DD"
  const words = trimmed.split(/\s+/);
  if (words.length === 2) {
    const [a, b] = words;
    const monthA = MONTHS_MAP[a];
    const monthB = MONTHS_MAP[b];
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);

    if (monthB && !isNaN(numA) && numA >= 1 && numA <= 31) {
      // "15 March"
      return `${String(monthB).padStart(2, '0')}-${String(numA).padStart(2, '0')}`;
    }
    if (monthA && !isNaN(numB) && numB >= 1 && numB <= 31) {
      // "March 15"
      return `${String(monthA).padStart(2, '0')}-${String(numB).padStart(2, '0')}`;
    }
  }

  return null;
}

async function resolveTimezone(city: string): Promise<{ city: string; timezone: string } | null> {
  try {
    const resp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`);
    if (!resp.ok) return null;
    const data = await resp.json() as { results?: { name: string; timezone: string }[] };
    if (!data.results?.length) return null;
    return { city: data.results[0].name, timezone: data.results[0].timezone };
  } catch {
    return null;
  }
}

async function resolveTimezoneFromCoords(lat: number, lon: number): Promise<{ city: string; timezone: string } | null> {
  try {
    // First get timezone from forecast API
    const forecastResp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`);
    if (!forecastResp.ok) return null;
    const forecastData = await forecastResp.json() as { timezone?: string };
    const timezone = forecastData.timezone || 'UTC';

    // Then reverse-geocode to get city name
    const geoResp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=&latitude=${lat}&longitude=${lon}&count=1`);
    let city = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    if (geoResp.ok) {
      const geoData = await geoResp.json() as { results?: { name: string }[] };
      if (geoData.results?.length) {
        city = geoData.results[0].name;
      }
    }

    // Fallback: use reverse geocoding via Open-Meteo's search by coordinates
    if (city.includes(',')) {
      // The geocoding API doesn't support reverse geocoding well, so extract city from timezone
      // e.g. "Europe/Moscow" → "Moscow", "America/New_York" → "New York"
      const parts = timezone.split('/');
      if (parts.length >= 2) {
        city = parts[parts.length - 1].replace(/_/g, ' ');
      }
    }

    return { city, timezone };
  } catch {
    return null;
  }
}

export class TelegramBot {
  private bot: Telegraf;
  private assistant: Assistant | null;
  private messageRepo: MessageRepository;
  private configManager: ConfigManager;
  private usageRepo: UsageRepository;
  private transcribe: Transcriber | null;
  private transcriberFactory: (() => Promise<Transcriber | undefined>) | null;
  private onSetupComplete?: () => Promise<void>;
  private onboardingState: OnboardingState | null = null;
  private lastLanguage: Map<number, string> = new Map(); // chatId → detected language
  private awaitingThresholdInput: Map<number, 'cpu' | 'ram' | 'disk'> = new Map(); // chatId → resource type
  private modelsCache: { models: { id: string; label: string }[]; fetchedAt: number } | null = null;

  constructor(
    token: string,
    assistant: Assistant | null,
    messageRepo: MessageRepository,
    configManager: ConfigManager,
    usageRepo: UsageRepository,
    transcribe?: Transcriber,
    transcriberFactory?: () => Promise<Transcriber | undefined>,
    onSetupComplete?: () => Promise<void>,
  ) {
    this.bot = new Telegraf(token);
    this.assistant = assistant;
    this.messageRepo = messageRepo;
    this.configManager = configManager;
    this.usageRepo = usageRepo;
    this.transcribe = transcribe ?? null;
    this.transcriberFactory = transcriberFactory ?? null;
    this.onSetupComplete = onSetupComplete;

    if (!assistant) {
      this.onboardingState = { step: 'provider' };
    }

    this.registerCommands();
    this.registerCallbacks();
    this.registerHandlers();

    this.bot.catch((err) => {
      console.error('Telegraf error:', err);
    });
  }

  setAssistant(assistant: Assistant): void {
    this.assistant = assistant;
    this.onboardingState = null;
  }

  private registerCommands(): void {
    this.bot.command('start', async (ctx) => {
      this.captureChatId(ctx.chat.id);
      if (this.onboardingState) {
        await this.sendOnboardingWelcome(ctx);
        return;
      }
      await ctx.reply(
        'Hi! I\'m Zaruka, your personal AI assistant.\n\n'
        + 'Just send me a message and I\'ll help you with tasks, weather, and more.\n\n'
        + 'Commands:\n'
        + '/settings — Configure model, language, thresholds\n'
        + '/usage — API token usage and costs\n'
        + '/resources — System resource usage\n'
        + '/help — Show this help',
      );
    });

    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        '🤖 Zaruka — Commands\n\n'
        + '/settings — Configure model, language, alert thresholds\n'
        + '/usage — API token usage and costs\n'
        + '/resources — Show current CPU, RAM, disk usage\n'
        + '/help — Show this help\n\n'
        + 'Or just send me any message!',
      );
    });

    this.bot.command('resources', async (ctx) => {
      this.captureChatId(ctx.chat.id);
      await ctx.sendChatAction('typing');
      const snapshot = await getResourceSnapshot();
      await ctx.reply(formatResourceReport(snapshot));
    });

    this.bot.command('usage', async (ctx) => {
      this.captureChatId(ctx.chat.id);

      const config = this.configManager.getConfig();
      if (!config.ai) {
        await ctx.reply('AI provider is not configured yet. Send /start to set it up.');
        return;
      }

      if (config.ai.provider === 'openai-compatible') {
        await ctx.reply(
          '💡 Usage Tracking\n\n'
          + 'You\'re using a local/self-hosted model.\n'
          + 'No usage limits apply - unlimited requests!'
        );
        return;
      }

      await ctx.reply(
        '📊 Usage Statistics — Select a time period:',
        Markup.inlineKeyboard([
          [Markup.button.callback('Today', 'usage:today'), Markup.button.callback('Week', 'usage:week')],
          [Markup.button.callback('Month', 'usage:month'), Markup.button.callback('Year', 'usage:year')],
        ]),
      );
    });

    this.bot.command('settings', async (ctx) => {
      this.captureChatId(ctx.chat.id);
      await this.sendSettingsMenu(ctx);
    });

    this.bot.command('cancel', async (ctx) => {
      const chatId = ctx.chat.id;
      if (this.awaitingThresholdInput.has(chatId)) {
        this.awaitingThresholdInput.delete(chatId);
        await ctx.reply('❌ Cancelled.');
      } else {
        await ctx.reply('Nothing to cancel.');
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async fetchAvailableModels(ai: ZarukaConfig['ai']): Promise<{ id: string; label: string }[]> {
    // Return cached result if fresh (1 hour TTL)
    if (this.modelsCache && Date.now() - this.modelsCache.fetchedAt < 3_600_000) {
      return this.modelsCache.models;
    }

    try {
      if (!ai) return [];

      let result: { id: string; label: string }[];

      if (ai.provider === 'anthropic') {
        result = await this.fetchAnthropicModels(ai);
      } else {
        // OpenAI / OpenAI-compatible
        const key = ai.apiKey || ai.authToken;
        const client = new OpenAI({
          apiKey: key || 'no-key',
          ...(ai.baseUrl ? { baseURL: ai.baseUrl } : {}),
        });
        const list = await client.models.list();
        const allModels = [];
        for await (const m of list) {
          allModels.push(m);
        }
        // Filter to chat models and sort by creation date (newest first)
        result = allModels
          .filter((m) => /^(gpt-|o[1-9]|chatgpt-)/.test(m.id) && !m.id.includes('realtime') && !m.id.includes('audio'))
          .sort((a, b) => b.created - a.created)
          .slice(0, 10)
          .map((m) => ({ id: m.id, label: m.id }));
      }

      if (result.length > 0) {
        this.modelsCache = { models: result, fetchedAt: Date.now() };
      }
      return result;
    } catch (err) {
      console.error('Failed to fetch models:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private async fetchAnthropicModels(ai: NonNullable<ZarukaConfig['ai']>): Promise<{ id: string; label: string }[]> {
    // Try the API first (works with API keys, not OAuth tokens yet)
    const key = ai.apiKey || ai.authToken;
    if (key) {
      try {
        const resp = await fetch('https://api.anthropic.com/v1/models?limit=20', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        });
        if (resp.ok) {
          const data = await resp.json() as { data: { id: string; display_name: string }[] };
          return data.data.map((m) => ({ id: m.id, label: m.display_name }));
        }
      } catch { /* fall through to docs scrape */ }
    }

    // Fallback for OAuth: fetch model IDs from Anthropic docs page
    try {
      const resp = await fetch('https://platform.claude.com/docs/en/about-claude/models/all-models');
      if (!resp.ok) throw new Error(`${resp.status}`);
      const html = await resp.text();
      // Extract all model IDs
      const idPattern = /claude-(?:opus|sonnet|haiku)-[\w.-]+/g;
      const allIds = new Set<string>();
      for (const match of html.matchAll(idPattern)) allIds.add(match[0]);

      // Keep only clean aliases: no dated versions (20250514), no -v1 suffixes
      const aliases = [...allIds].filter((id) => !/\d{8}|-v\d/.test(id));

      // Group by family (opus/sonnet/haiku) and pick the highest version in each
      const families = new Map<string, string[]>();
      for (const id of aliases) {
        const family = id.match(/claude-(opus|sonnet|haiku)/)?.[1] ?? '';
        if (!families.has(family)) families.set(family, []);
        families.get(family)!.push(id);
      }

      const models: { id: string; label: string }[] = [];
      for (const [, ids] of families) {
        // Sort by version descending (longer version string = higher version)
        ids.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        const latest = ids[0];
        // Format label: claude-opus-4-6 → Claude Opus 4.6
        const label = latest
          .replace(/^claude-/, '')
          .replace(/-/g, ' ')
          .replace(/(\w+)\s(\d+)\s(\d+)/, (_, name, major, minor) =>
            `Claude ${name.charAt(0).toUpperCase() + name.slice(1)} ${major}.${minor}`)
          .replace(/(\w+)\s(\d+)$/, (_, name, major) =>
            `Claude ${name.charAt(0).toUpperCase() + name.slice(1)} ${major}`);
        models.push({ id: latest, label });
      }
      if (models.length > 0) return models;
    } catch (err) {
      console.error('Failed to fetch Anthropic models from docs:', err instanceof Error ? err.message : err);
    }

    return [];
  }

  private settingsText(): string {
    const model = this.configManager.getModel();
    const lang = this.configManager.getLanguage();
    const alertsEnabled = this.configManager.isResourceMonitorEnabled();
    return '⚙️ Settings\n\n'
      + `Model: ${model}\n`
      + `Language: ${lang}\n`
      + `Resource alerts: ${alertsEnabled ? 'On' : 'Off'}`;
  }

  private settingsKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🧠 Model', 'settings:model')],
      [Markup.button.callback('🌐 Language', 'settings:lang')],
      [Markup.button.callback('📈 Resources', 'settings:resources')],
    ]);
  }

  private async sendSettingsMenu(ctx: any): Promise<void> {
    await ctx.reply(this.settingsText(), this.settingsKeyboard());
  }

  private registerCallbacks(): void {
    // Model selection
    this.bot.action('settings:model', async (ctx) => {
      await ctx.answerCbQuery();
      const current = this.configManager.getModel();
      const ai = this.configManager.getConfig().ai;

      await ctx.editMessageText(`Current model: ${current}\n\nLoading available models...`);

      const models = await this.fetchAvailableModels(ai);
      const modelButtons = models.map((m) => [Markup.button.callback(m.label, `model:${m.id}`)]);

      await ctx.editMessageText(
        `Current model: ${current}\n\nChoose a new model:`,
        Markup.inlineKeyboard([
          ...modelButtons,
          [Markup.button.callback('« Back', 'settings:back')],
        ]),
      );
    });

    this.bot.action(/^model:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const model = ctx.match[1];
      this.configManager.updateModel(model);
      await ctx.editMessageText(`✓ Model changed to ${model}`);
    });

    // Language selection
    this.bot.action('settings:lang', async (ctx) => {
      await ctx.answerCbQuery();
      const current = this.configManager.getLanguage();
      await ctx.editMessageText(
        `Current language: ${current}\n\nChoose:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('Auto-detect', 'lang:auto')],
          [Markup.button.callback('English', 'lang:English'), Markup.button.callback('Русский', 'lang:Russian')],
          [Markup.button.callback('Español', 'lang:Spanish'), Markup.button.callback('Français', 'lang:French')],
          [Markup.button.callback('Deutsch', 'lang:German'), Markup.button.callback('中文', 'lang:Chinese')],
          [Markup.button.callback('« Back', 'settings:back')],
        ]),
      );
    });

    this.bot.action(/^lang:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const lang = ctx.match[1];
      this.configManager.updateLanguage(lang);
      await ctx.editMessageText(`✓ Language changed to ${lang}`);
    });

    // Threshold selections (CPU, RAM, Disk)
    for (const [key, label] of [['cpu', 'CPU'], ['ram', 'RAM'], ['disk', 'Disk']] as const) {
      this.bot.action(`settings:${key}`, async (ctx) => {
        await ctx.answerCbQuery();
        const thresholds = this.configManager.getThresholds();
        const current = thresholds[`${key}Percent` as keyof typeof thresholds];
        await ctx.editMessageText(
          `Current ${label} alert threshold: ${current}%\n\nAlert when usage exceeds:`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback('70%', `thresh:${key}:70`),
              Markup.button.callback('80%', `thresh:${key}:80`),
            ],
            [
              Markup.button.callback('90%', `thresh:${key}:90`),
              Markup.button.callback('95%', `thresh:${key}:95`),
            ],
            [Markup.button.callback('✏️ Custom', `thresh:${key}:custom`)],
            [Markup.button.callback('« Back', 'settings:resources')],
          ]),
        );
      });
    }

    this.bot.action(/^thresh:(cpu|ram|disk):(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const resource = ctx.match[1] as 'cpu' | 'ram' | 'disk';
      const value = parseInt(ctx.match[2], 10);
      const keyMap = { cpu: 'cpuPercent', ram: 'ramPercent', disk: 'diskPercent' } as const;
      this.configManager.updateThreshold(keyMap[resource], value);
      await ctx.editMessageText(`✓ ${resource.toUpperCase()} alert threshold set to ${value}%`);
    });

    // Custom threshold input
    this.bot.action(/^thresh:(cpu|ram|disk):custom$/, async (ctx) => {
      await ctx.answerCbQuery();
      const resource = ctx.match[1] as 'cpu' | 'ram' | 'disk';
      const resourceLabel = { cpu: 'CPU', ram: 'RAM', disk: 'Disk' }[resource];
      this.awaitingThresholdInput.set(ctx.chat!.id, resource);
      await ctx.editMessageText(
        `✏️ Custom ${resourceLabel} threshold\n\n`
        + 'Please send a number between 1 and 100 (e.g., 85)\n\n'
        + 'Send /cancel to cancel.'
      );
    });

    // Onboarding: provider selection
    this.bot.action(/^onboard:(anthropic|openai|openai-compatible)$/, async (ctx) => {
      await ctx.answerCbQuery();
      if (!this.onboardingState) return;

      const provider = ctx.match[1] as OnboardingState['provider'];
      this.onboardingState.provider = provider;

      if (provider === 'openai-compatible') {
        this.onboardingState.step = 'base_url';
        await ctx.editMessageText(
          'Enter the base URL of your API endpoint.\n\n'
          + 'Example: http://localhost:11434/v1',
        );
      } else {
        this.onboardingState.step = 'auth_method';
        const providerLabel = provider === 'anthropic' ? 'Claude' : 'ChatGPT';
        await ctx.editMessageText(
          'How would you like to authenticate?',
          Markup.inlineKeyboard([
            [Markup.button.callback('API Key (pay-as-you-go)', 'onboard_auth:api_key')],
            [Markup.button.callback(`Sign in with ${providerLabel} (subscription)`, 'onboard_auth:oauth')],
          ]),
        );
      }
    });

    // Onboarding: auth method selection
    this.bot.action(/^onboard_auth:(api_key|oauth)$/, async (ctx) => {
      await ctx.answerCbQuery();
      if (!this.onboardingState) return;

      const method = ctx.match[1];
      const provider = this.onboardingState.provider;
      this.onboardingState.step = 'api_key';

      if (method === 'api_key') {
        this.onboardingState.isOAuth = false;
        const hint = provider === 'anthropic'
          ? 'Send your Anthropic API key (starts with `sk-ant-`).\n\nGet one at: https://console.anthropic.com/settings/keys'
          : 'Send your OpenAI API key (starts with `sk-`).\n\nGet one at: https://platform.openai.com/api-keys';
        await ctx.editMessageText(hint);
      } else {
        this.onboardingState.isOAuth = true;
        if (provider === 'anthropic') {
          const pkce = generatePKCE();
          this.onboardingState.codeVerifier = pkce.codeVerifier;
          this.onboardingState.oauthState = pkce.state;
          const authUrl = buildAuthUrl(ANTHROPIC_OAUTH, pkce);
          await ctx.editMessageText(
            'Sign in with your Claude account:\n\n'
            + authUrl + '\n\n'
            + 'After signing in, copy the full URL from your browser and send it here.\n\n'
            + 'Or paste a setup token (starts with sk-ant-oat01-).',
          );
        } else {
          try {
            const { deviceAuthId, userCode } = await requestDeviceCode(OPENAI_OAUTH);
            this.onboardingState.deviceAuthId = deviceAuthId;
            this.onboardingState.deviceUserCode = userCode;
            await ctx.editMessageText(
              'Sign in with your ChatGPT account:\n\n'
              + '1. Open: https://auth.openai.com/codex/device\n'
              + `2. Enter code: ${userCode}\n\n`
              + 'After signing in, send "done" here.\n\n'
              + 'Or paste a session token if you have one.',
            );
          } catch (err) {
            console.error('Device code request failed:', err);
            await ctx.editMessageText(
              'Could not start device authorization. Please paste your API key or session token directly.',
            );
          }
        }
      }
    });

    // Onboarding: model selection
    this.bot.action(/^onboard_model:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      if (!this.onboardingState) return;

      const model = ctx.match[1];
      this.onboardingState.model = model;
      this.onboardingState.step = 'testing';

      await ctx.editMessageText('Testing connection...');
      await this.finishOnboarding(ctx);
    });

    // Onboarding: retry after failure
    this.bot.action('onboard:retry', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendOnboardingWelcome(ctx);
    });

    // Onboarding: name confirmation
    this.bot.action('onboard_name:confirm', async (ctx) => {
      await ctx.answerCbQuery();
      if (!this.onboardingState || this.onboardingState.step !== 'ask_name') return;
      this.onboardingState.profileName = this.onboardingState.telegramFirstName || '';
      this.onboardingState.step = 'ask_city';
      await this.sendAskCity(ctx);
    });

    this.bot.action('onboard_name:change', async (ctx) => {
      await ctx.answerCbQuery();
      if (!this.onboardingState || this.onboardingState.step !== 'ask_name') return;
      await ctx.editMessageText('What should I call you?');
      // Stay on ask_name step, next text input will be the name
    });

    // Onboarding: city skip
    this.bot.action('onboard_skip:city', async (ctx) => {
      await ctx.answerCbQuery();
      if (!this.onboardingState) return;
      this.onboardingState.step = 'ask_birthday';
      await this.sendAskBirthday(ctx);
    });

    // Onboarding: city type manually
    this.bot.action('onboard_city:type', async (ctx) => {
      await ctx.answerCbQuery();
      if (!this.onboardingState) return;
      await ctx.reply('Type your city name:', Markup.removeKeyboard());
      // Stay on ask_city step, next text input will be the city
    });

    // Onboarding: birthday skip
    this.bot.action('onboard_skip:birthday', async (ctx) => {
      await ctx.answerCbQuery();
      if (!this.onboardingState) return;
      await this.completeOnboarding(ctx);
    });

    // Toggle resource alerts
    // Resources sub-menu
    this.bot.action('settings:resources', async (ctx) => {
      await ctx.answerCbQuery();
      const thresholds = this.configManager.getThresholds();
      const alertsEnabled = this.configManager.isResourceMonitorEnabled();
      await ctx.editMessageText(
        '📈 Resources\n\n'
        + `Alerts: ${alertsEnabled ? 'On' : 'Off'}\n`
        + `CPU threshold: ${thresholds.cpuPercent}%\n`
        + `RAM threshold: ${thresholds.ramPercent}%\n`
        + `Disk threshold: ${thresholds.diskPercent}%`,
        Markup.inlineKeyboard([
          [Markup.button.callback(`🔔 Alerts: ${alertsEnabled ? 'On' : 'Off'}`, 'settings:toggle_alerts')],
          [Markup.button.callback('📊 CPU threshold', 'settings:cpu')],
          [Markup.button.callback('💾 RAM threshold', 'settings:ram')],
          [Markup.button.callback('💿 Disk threshold', 'settings:disk')],
          [Markup.button.callback('« Back', 'settings:back')],
        ]),
      );
    });

    this.bot.action('settings:toggle_alerts', async (ctx) => {
      await ctx.answerCbQuery();
      const current = this.configManager.isResourceMonitorEnabled();
      this.configManager.setResourceMonitorEnabled(!current);
      const alertsEnabled = !current;
      const thresholds = this.configManager.getThresholds();
      // Re-render resources sub-menu
      await ctx.editMessageText(
        '📈 Resources\n\n'
        + `Alerts: ${alertsEnabled ? 'On' : 'Off'}\n`
        + `CPU threshold: ${thresholds.cpuPercent}%\n`
        + `RAM threshold: ${thresholds.ramPercent}%\n`
        + `Disk threshold: ${thresholds.diskPercent}%`,
        Markup.inlineKeyboard([
          [Markup.button.callback(`🔔 Alerts: ${alertsEnabled ? 'On' : 'Off'}`, 'settings:toggle_alerts')],
          [Markup.button.callback('📊 CPU threshold', 'settings:cpu')],
          [Markup.button.callback('💾 RAM threshold', 'settings:ram')],
          [Markup.button.callback('💿 Disk threshold', 'settings:disk')],
          [Markup.button.callback('« Back', 'settings:back')],
        ]),
      );
    });

    // Usage period selection — powered by ccusage
    this.bot.action(/^usage:(today|week|month|year)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const period = ctx.match[1] as 'today' | 'week' | 'month' | 'year';

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Today', 'usage:today'), Markup.button.callback('Week', 'usage:week')],
        [Markup.button.callback('Month', 'usage:month'), Markup.button.callback('Year', 'usage:year')],
      ]);

      try {
        const { loadDailyUsageData } = await import('ccusage/data-loader');
        const { calculateTotals, createTotalsObject } = await import('ccusage/calculate-cost');

        const sinceMap: Record<string, string> = {
          today: new Date().toISOString().slice(0, 10),
          week: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
          month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
          year: `${new Date().getFullYear()}-01-01`,
        };
        const labelMap: Record<string, string> = {
          today: 'Today',
          week: 'Last 7 days',
          month: new Date().toLocaleString('en', { month: 'long', year: 'numeric' }),
          year: String(new Date().getFullYear()),
        };

        const daily = await loadDailyUsageData({
          since: sinceMap[period],
          mode: 'auto',
        });

        const label = labelMap[period];

        if (daily.length === 0) {
          try {
            await ctx.editMessageText(`📊 Usage — ${label}\n\nNo usage data for this period.`, keyboard);
          } catch { /* ignore */ }
          return;
        }

        const totals = createTotalsObject(calculateTotals(daily));

        const lines: string[] = [`📊 Usage — ${label}`, ''];
        lines.push(`Input: ${fmtNum(totals.inputTokens)}`);
        lines.push(`Output: ${fmtNum(totals.outputTokens)}`);
        lines.push(`Cache write: ${fmtNum(totals.cacheCreationTokens)}`);
        lines.push(`Cache read: ${fmtNum(totals.cacheReadTokens)}`);
        lines.push(`Total: ${fmtNum(totals.totalTokens)}`);
        lines.push(`Cost: $${totals.totalCost.toFixed(2)}`);

        // Model breakdown from daily data
        const modelMap = new Map<string, { input: number; output: number; cacheW: number; cacheR: number; cost: number }>();
        for (const d of daily) {
          if (!d.modelBreakdowns) continue;
          for (const mb of d.modelBreakdowns) {
            const existing = modelMap.get(mb.modelName);
            if (existing) {
              existing.input += mb.inputTokens;
              existing.output += mb.outputTokens;
              existing.cacheW += mb.cacheCreationTokens;
              existing.cacheR += mb.cacheReadTokens;
              existing.cost += mb.cost;
            } else {
              modelMap.set(mb.modelName, {
                input: mb.inputTokens,
                output: mb.outputTokens,
                cacheW: mb.cacheCreationTokens,
                cacheR: mb.cacheReadTokens,
                cost: mb.cost,
              });
            }
          }
        }

        if (modelMap.size > 0) {
          lines.push('', 'Per model:');
          const sorted = [...modelMap.entries()].sort((a, b) => b[1].cost - a[1].cost);
          for (const [name, m] of sorted) {
            lines.push(`  ${name}: $${m.cost.toFixed(2)} (${fmtNum(m.input + m.output + m.cacheW + m.cacheR)} tok)`);
          }
        }

        try {
          await ctx.editMessageText(lines.join('\n'), keyboard);
        } catch {
          // Message might be identical
        }

        // Chart for multi-day periods
        if (period !== 'today' && daily.length > 1) {
          await this.sendUsageChart(ctx, daily, label, period);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('ccusage load failed:', errMsg);
        const isNoData = errMsg.includes('No valid Claude data') || errMsg.includes('no such file');
        const userMsg = isNoData
          ? 'No usage data yet. Send me a message first, then check /usage again.'
          : 'Failed to load usage data: ' + errMsg;
        try {
          await ctx.editMessageText(userMsg, keyboard);
        } catch { /* ignore */ }
      }
    });

    // Back to settings
    this.bot.action('settings:back', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.editMessageText(this.settingsText(), this.settingsKeyboard());
    });
  }

  private registerHandlers(): void {
    // Handle location sharing (for onboarding city/timezone step)
    this.bot.on('location', async (ctx) => {
      this.captureChatId(ctx.chat.id);
      if (!this.onboardingState || this.onboardingState.step !== 'ask_city') return;

      const { latitude, longitude } = ctx.message.location;
      await ctx.reply('Resolving your location...', Markup.removeKeyboard());

      const result = await resolveTimezoneFromCoords(latitude, longitude);
      if (result) {
        this.onboardingState.profileCity = result.city;
        this.onboardingState.profileTimezone = result.timezone;
        await ctx.reply(`Got it, ${result.city} (${result.timezone})!`);
      } else {
        await ctx.reply('Could not determine timezone from location, skipping.');
      }

      this.onboardingState.step = 'ask_birthday';
      await this.sendAskBirthday(ctx);
    });

    this.bot.on('voice', (ctx) => {
      this.captureChatId(ctx.chat.id);
      if (!this.assistant) {
        ctx.reply('AI is not configured yet. Send /start to set up.').catch(() => {});
        return;
      }
      this.handleVoice(ctx).catch((err) => console.error('Voice handler error:', err));
    });

    this.bot.on('text', (ctx) => {
      const chatId = ctx.chat.id;
      this.captureChatId(chatId);
      const text = ctx.message.text;

      // Onboarding: route text input to onboarding handler
      if (this.onboardingState) {
        this.handleOnboardingText(ctx, text).catch((err) => console.error('Onboarding text error:', err));
        return;
      }

      // Check if we're awaiting threshold input
      if (this.awaitingThresholdInput.has(chatId)) {
        this.handleThresholdInput(ctx, text).catch((err) => console.error('Threshold input error:', err));
        return;
      }

      // No assistant yet (should not happen after onboarding, but guard)
      if (!this.assistant) {
        ctx.reply('AI is not configured. Send /start to set up.').catch(() => {});
        return;
      }

      // Detect language from user's message and track it
      const detected = detectLanguage(text);
      if (detected) {
        this.lastLanguage.set(chatId, detected);
      }

      // Add language hint if the message has no clear language (e.g. just credentials/numbers)
      let message = text;
      if (!detected && this.lastLanguage.has(chatId)) {
        message = `[Continue in ${this.lastLanguage.get(chatId)}]\n${text}`;
      }

      // Fire-and-forget to avoid Telegraf's 90s handler timeout
      this.processAndReply(ctx, message).catch((err) => console.error('Text handler error:', err));
    });
  }

  private captureChatId(chatId: number): void {
    if (!this.configManager.getChatId()) {
      this.configManager.setChatId(chatId);
      console.log(`Chat ID captured: ${chatId}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleThresholdInput(ctx: any, text: string): Promise<void> {
    const chatId = ctx.chat.id;
    const resource = this.awaitingThresholdInput.get(chatId);

    if (!resource) return;

    // Check for cancel
    if (text === '/cancel') {
      this.awaitingThresholdInput.delete(chatId);
      await ctx.reply('❌ Cancelled. Threshold not changed.');
      return;
    }

    // Parse number
    const value = parseInt(text.trim(), 10);

    if (isNaN(value) || value < 1 || value > 100) {
      await ctx.reply(
        '❌ Invalid number. Please send a number between 1 and 100.\n\n'
        + 'Send /cancel to cancel.'
      );
      return;
    }

    // Update threshold
    const keyMap = { cpu: 'cpuPercent', ram: 'ramPercent', disk: 'diskPercent' } as const;
    this.configManager.updateThreshold(keyMap[resource], value);
    this.awaitingThresholdInput.delete(chatId);

    await ctx.reply(`✅ ${resource.toUpperCase()} alert threshold set to ${value}%`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleVoice(ctx: any): Promise<void> {
    // Lazy setup: try to create transcriber if not yet available
    if (!this.transcribe && this.transcriberFactory) {
      try {
        const t = await this.transcriberFactory();
        if (t) {
          this.transcribe = t;
          console.log('Voice transcription: enabled (lazy setup)');
        }
      } catch (err) {
        console.error('Failed to lazy-setup transcriber:', err);
      }
    }

    // If still no transcriber, let Claude handle the situation
    if (!this.transcribe) {
      const duration = ctx.message.voice.duration;
      await this.processAndReply(
        ctx,
        `[The user sent a voice message (${duration}s). Voice transcription is not available. `
        + 'Explain that you received a voice message but cannot listen to it yet. '
        + 'Suggest solutions: the user can set GROQ_API_KEY environment variable (free, https://console.groq.com) '
        + 'or install ffmpeg (brew install ffmpeg / apt install ffmpeg) for local offline transcription. '
        + 'Ask the user to resend the message as text for now.]',
      );
      return;
    }

    try {
      await ctx.sendChatAction('typing');
      const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
      const text = await this.transcribe(fileLink.href);
      if (!text) {
        await ctx.reply('Could not transcribe the voice message. Please try again.');
        return;
      }
      await this.processAndReply(ctx, text);
    } catch (err) {
      console.error('Error processing voice message:', err);
      await ctx.reply('Sorry, something went wrong processing your voice message.');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async sendOnboardingWelcome(ctx: any): Promise<void> {
    this.onboardingState = { step: 'provider' };
    await ctx.reply(
      'Welcome to Zaruka! Let\'s set up your AI provider.\n\n'
      + 'Choose your AI provider:',
      Markup.inlineKeyboard([
        [Markup.button.callback('Anthropic (Claude)', 'onboard:anthropic')],
        [Markup.button.callback('OpenAI (GPT)', 'onboard:openai')],
        [Markup.button.callback('Self-hosted (Ollama, etc.)', 'onboard:openai-compatible')],
      ]),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleOnboardingText(ctx: any, text: string): Promise<void> {
    if (!this.onboardingState) return;
    const state = this.onboardingState;

    if (state.isPolling) {
      await ctx.reply('Please wait, checking authorization...');
      return;
    }

    switch (state.step) {
      case 'provider': {
        // User sent text instead of clicking a button
        await this.sendOnboardingWelcome(ctx);
        break;
      }
      case 'auth_method': {
        // User sent text instead of clicking a button
        await ctx.reply('Please choose an authentication method using the buttons above.');
        break;
      }
      case 'base_url': {
        // Self-hosted: receive base URL
        state.baseUrl = text.trim();
        state.step = 'api_key';
        await ctx.reply(
          'Send your API key, or send `-` to skip (if your endpoint has no auth).',
        );
        break;
      }
      case 'api_key': {
        const input = text.trim();

        if (state.isOAuth && state.provider === 'anthropic') {
          if (input.startsWith('sk-ant-oat01-')) {
            // Direct setup token
            state.apiKey = input;
          } else {
            // Extract auth code from callback URL and exchange for tokens
            try {
              const code = extractAuthCode(input);
              const tokens = await exchangeCodeForTokens(
                ANTHROPIC_OAUTH,
                code,
                state.codeVerifier!,
                state.oauthState,
              );
              state.apiKey = tokens.accessToken;
              state.refreshToken = tokens.refreshToken;
              state.tokenExpiresIn = tokens.expiresIn;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              await ctx.reply(
                'Failed to exchange authorization code: ' + msg + '\n\n'
                + 'Please try again — paste the full URL from your browser, or a setup token.',
              );
              return;
            }
          }
        } else if (state.isOAuth && state.provider === 'openai') {
          const lower = input.toLowerCase();
          if (lower === 'done' || lower === '\u0433\u043e\u0442\u043e\u0432\u043e') {
            // Poll for device token
            if (!state.deviceAuthId) {
              await ctx.reply('No device authorization in progress. Please start over with /start.');
              return;
            }
            try {
              await ctx.reply('Checking authorization...');
              state.isPolling = true;
              let lastUpdate = 0;
              const tokens = await pollDeviceToken(
                OPENAI_OAUTH,
                state.deviceAuthId,
                60,
                5000,
                (attempt, max, status) => {
                  const now = Date.now();
                  // Send update every 30 seconds
                  if (now - lastUpdate > 30000) {
                    lastUpdate = now;
                    const remaining = Math.ceil((max - attempt) * 5 / 60);
                    ctx.reply(`Still waiting for authorization... (${status}, ~${remaining} min left)`).catch(() => {});
                  }
                },
              );
              state.isPolling = false;
              state.apiKey = tokens.accessToken;
              state.refreshToken = tokens.refreshToken;
              state.tokenExpiresIn = tokens.expiresIn;
            } catch (err) {
              state.isPolling = false;
              const msg = err instanceof Error ? err.message : String(err);
              await ctx.reply(
                'Device authorization failed: ' + msg + '\n\n'
                + 'Please try again or paste a session token directly.',
              );
              return;
            }
          } else {
            // Treat as direct token
            state.apiKey = input;
          }
        } else {
          state.apiKey = input === '-' ? undefined : input;
        }

        state.step = 'model';
        await this.sendModelSelection(ctx);
        break;
      }
      case 'model': {
        // Free-text model name (for self-hosted)
        state.model = text.trim();
        state.step = 'testing';
        await ctx.reply('Testing connection...');
        await this.finishOnboarding(ctx);
        break;
      }
      case 'ask_name': {
        // User typed a custom name
        state.profileName = text.trim();
        state.step = 'ask_city';
        await this.sendAskCity(ctx);
        break;
      }
      case 'ask_city': {
        // User typed a city name
        const cityResult = await resolveTimezone(text.trim());
        if (cityResult) {
          state.profileCity = cityResult.city;
          state.profileTimezone = cityResult.timezone;
          await ctx.reply(`Got it, ${cityResult.city} (${cityResult.timezone})!`, Markup.removeKeyboard());
        } else {
          // Couldn't resolve, just save what they typed
          state.profileCity = text.trim();
          await ctx.reply(`Saved "${text.trim()}" as your city.`, Markup.removeKeyboard());
        }
        state.step = 'ask_birthday';
        await this.sendAskBirthday(ctx);
        break;
      }
      case 'ask_birthday': {
        const birthday = parseBirthday(text);
        if (birthday) {
          state.profileBirthday = birthday;
          // Format for display
          const [mm, dd] = birthday.split('-');
          const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          await ctx.reply(`Got it, ${monthNames[parseInt(mm, 10) - 1]} ${parseInt(dd, 10)}!`);
        } else {
          await ctx.reply('Could not parse the date. Skipping birthday.');
        }
        await this.completeOnboarding(ctx);
        break;
      }
      default:
        break;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async sendModelSelection(ctx: any): Promise<void> {
    const state = this.onboardingState;
    if (!state) return;

    if (state.provider === 'anthropic') {
      await ctx.reply(
        'Choose a model:',
        Markup.inlineKeyboard([
          [Markup.button.callback('Claude Sonnet 4.5 (recommended)', 'onboard_model:claude-sonnet-4-5-20250929')],
          [Markup.button.callback('Claude Haiku 4.5 (fast & cheap)', 'onboard_model:claude-haiku-4-5-20251001')],
          [Markup.button.callback('Claude Opus 4.6 (most powerful)', 'onboard_model:claude-opus-4-6')],
        ]),
      );
    } else if (state.provider === 'openai') {
      await ctx.reply(
        'Choose a model:',
        Markup.inlineKeyboard([
          [Markup.button.callback('GPT-4o (recommended)', 'onboard_model:gpt-4o')],
          [Markup.button.callback('GPT-4o mini (fast & cheap)', 'onboard_model:gpt-4o-mini')],
        ]),
      );
    } else {
      // Self-hosted: ask for model name as text
      await ctx.reply('Enter your model name (e.g. `llama3`, `mistral`, `qwen2`):');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async finishOnboarding(ctx: any): Promise<void> {
    const state = this.onboardingState;
    if (!state || !state.provider || !state.model) return;

    const tokenExpiresAt = state.tokenExpiresIn
      ? new Date(Date.now() + state.tokenExpiresIn * 1000).toISOString()
      : undefined;

    const aiConfig: NonNullable<ZarukaConfig['ai']> = {
      provider: state.provider,
      apiKey: state.isOAuth ? undefined : state.apiKey,
      authToken: state.isOAuth ? state.apiKey : undefined,
      refreshToken: state.isOAuth ? state.refreshToken : undefined,
      tokenExpiresAt: state.isOAuth ? tokenExpiresAt : undefined,
      model: state.model,
      baseUrl: state.baseUrl ?? null,
    };

    // Test connection
    const result = await testAiConnection(aiConfig);
    if (!result.ok) {
      // Reset to let user retry
      this.onboardingState = { step: 'provider' };
      await ctx.reply(
        'Connection failed: ' + (result.error || 'Unknown error') + '\n\n'
        + 'Please try again.',
        Markup.inlineKeyboard([
          [Markup.button.callback('Retry setup', 'onboard:retry')],
        ]),
      );

      return;
    }

    // Save config
    this.configManager.updateAiConfig(aiConfig);

    // Transition to profile questionnaire
    const firstName = ctx.from?.first_name || '';
    this.onboardingState = {
      ...state,
      step: 'ask_name',
      telegramFirstName: firstName,
    };

    await ctx.reply(
      `Connection successful! Can I call you *${firstName}*?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Yes', 'onboard_name:confirm')],
          [Markup.button.callback('Call me differently', 'onboard_name:change')],
        ]),
      },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async sendAskCity(ctx: any): Promise<void> {
    const name = this.onboardingState?.profileName || '';
    // Send inline keyboard with Skip and Type options
    await ctx.reply(
      `${name}, share your location so I can sync with your timezone — my time references and reminders will match your local time.`,
      Markup.keyboard([
        [Markup.button.locationRequest('📍 Share location')],
      ]).oneTime().resize(),
    );
    // Also send inline buttons for skip/type
    await ctx.reply(
      'Or choose:',
      Markup.inlineKeyboard([
        [Markup.button.callback('Type city name', 'onboard_city:type')],
        [Markup.button.callback('Skip', 'onboard_skip:city')],
      ]),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async sendAskBirthday(ctx: any): Promise<void> {
    await ctx.reply(
      'When is your birthday? I\'ll remember and make sure to congratulate you! (e.g. 15 March, 15.03)',
      Markup.inlineKeyboard([
        [Markup.button.callback('Skip', 'onboard_skip:birthday')],
      ]),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async completeOnboarding(ctx: any): Promise<void> {
    const state = this.onboardingState;
    if (!state) return;

    // Save profile
    const profile: { name?: string; city?: string; timezone?: string; birthday?: string } = {};
    if (state.profileName) profile.name = state.profileName;
    if (state.profileCity) profile.city = state.profileCity;
    if (state.profileBirthday) profile.birthday = state.profileBirthday;
    if (state.profileTimezone) {
      profile.timezone = state.profileTimezone;
      this.configManager.updateTimezone(state.profileTimezone);
    }

    if (Object.keys(profile).length > 0) {
      this.configManager.updateProfile(profile);
    }

    // Detect language from Telegram
    const langCode = ctx.from?.language_code;
    if (langCode && this.configManager.getLanguage() === 'auto') {
      const langMap: Record<string, string> = {
        ru: 'Russian', en: 'English', es: 'Spanish', fr: 'French',
        de: 'German', zh: 'Chinese', ja: 'Japanese', ar: 'Arabic',
      };
      const detected = langMap[langCode];
      if (detected) {
        this.configManager.updateLanguage(detected);
      }
    }

    // Call the setup complete callback to build the assistant
    if (this.onSetupComplete) {
      try {
        await this.onSetupComplete();
      } catch (err) {
        console.error('Failed to initialize assistant after onboarding:', err);
        await ctx.reply('Setup saved but failed to initialize. Please restart the bot.');
        return;
      }
    }

    const name = state.profileName || state.telegramFirstName || '';
    const greeting = name ? `${name}, setup` : 'Setup';
    await ctx.reply(
      `${greeting} complete! Send me any message and I'll help you.`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async processAndReply(ctx: any, userMessage: string): Promise<void> {
    const chatId: number = ctx.chat.id;

    // Load recent conversation history from DB (last 20 messages for context window)
    const recentMessages = this.messageRepo.getRecent(chatId, 20);
    const history: ChatMessage[] = recentMessages.map((m) => ({ role: m.role, text: m.text }));

    // Keep typing indicator alive during long operations (evolve_skill retries, etc.)
    const typingInterval = setInterval(() => {
      ctx.sendChatAction('typing').catch(() => {});
    }, 4000);

    try {
      await ctx.sendChatAction('typing');
      const response = await this.assistant!.process(userMessage, history);
      clearInterval(typingInterval);

      // Persist both messages to DB (full history, no limit)
      this.messageRepo.save(chatId, 'user', userMessage);
      if (response) {
        this.messageRepo.save(chatId, 'assistant', response);
      }

      if (response) {
        const chunks = this.splitMessage(response, 4000);
        for (const chunk of chunks) {
          await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(() => {
            return ctx.reply(chunk);
          });
        }
      }
    } catch (err) {
      clearInterval(typingInterval);
      console.error('Error processing message:', err);

      // Check for rate limit / quota errors
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isRateLimit = errorMsg.includes('rate_limit')
        || errorMsg.includes('quota')
        || errorMsg.includes('limit exceeded')
        || errorMsg.includes('429');

      if (isRateLimit) {
        const config = this.configManager.getConfig();
        const isOAuth = !!(config.ai?.authToken);

        if (isOAuth) {
          await ctx.reply(
            '⚠️ Reached Claude usage limits\n\n'
            + 'Your Claude subscription limits have been exceeded.\n\n'
            + '📊 Check usage: https://claude.ai/settings/usage\n'
            + '💡 Limits reset daily/weekly depending on your plan.\n\n'
            + 'Try again later or upgrade your plan.'
          );
        } else {
          await ctx.reply(
            '⚠️ API Rate Limit Exceeded\n\n'
            + 'Your API rate limit has been reached.\n\n'
            + '📊 Check usage: https://console.anthropic.com/settings/usage\n'
            + '💳 Check plan: https://console.anthropic.com/settings/billing\n\n'
            + 'Wait a few minutes or upgrade your plan.'
          );
        }
      } else {
        await ctx.reply(
          '❌ Error processing your message.\n\n'
          + 'Please try again. If the problem persists, check /settings or contact support.'
        );
      }
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt === -1 || splitAt < maxLength / 2) {
        splitAt = maxLength;
      }
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }
    return chunks;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async sendUsageChart(ctx: any, daily: { date: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalCost: number }[], label: string, period?: string): Promise<void> {
    try {
      const { generateUsageChart } = await import('../charts/usage-chart.js');
      const chartData = daily.map((d) => ({
        date: d.date,
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
        cacheCreationTokens: d.cacheCreationTokens,
        cacheReadTokens: d.cacheReadTokens,
        cost: d.totalCost,
      }));

      const tokensPng = await generateUsageChart(chartData, {
        title: `${label} — Tokens`,
        mode: 'tokens',
        period: period as 'today' | 'week' | 'month' | 'year',
      });
      await ctx.replyWithPhoto({ source: tokensPng });

      const hasCost = chartData.some((d) => d.cost > 0);
      if (hasCost) {
        const costPng = await generateUsageChart(chartData, {
          title: `${label} — Cost (USD)`,
          mode: 'cost',
          period: period as 'today' | 'week' | 'month' | 'year',
        });
        await ctx.replyWithPhoto({ source: costPng });
      }
    } catch (err) {
      console.error('Chart generation failed:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Returns a function that sends a message to the captured chat.
   * Used by Scheduler for alerts and reminders.
   */
  getSendMessageFn(): (message: string) => Promise<void> {
    return async (message: string) => {
      const chatId = this.configManager.getChatId();
      if (!chatId) {
        console.warn('Cannot send message: no chat ID captured yet. Send any message to the bot first.');
        return;
      }
      await this.bot.telegram.sendMessage(chatId, message);
    };
  }

  async start(): Promise<void> {
    // Register bot commands menu in Telegram
    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'settings', description: 'Configure model, language, thresholds' },
      { command: 'usage', description: 'API token usage and costs' },
      { command: 'resources', description: 'System resource usage' },
      { command: 'help', description: 'Show help' },
    ]);

    console.log('Telegram bot starting (polling mode)...');
    await this.bot.launch();
    console.log('Telegram bot is running.');

    const shutdown = () => {
      this.bot.stop('SIGINT');
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }

  stop(): void {
    this.bot.stop();
  }
}
