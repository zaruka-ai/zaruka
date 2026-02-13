import { Telegraf, Markup } from 'telegraf';
import type { Assistant } from '../core/assistant.js';
import type { ChatMessage } from '../providers/anthropic.js';
import type { MessageRepository } from '../db/message-repository.js';
import type { ConfigManager } from '../core/config-manager.js';
import type { UsageRepository } from '../db/usage-repository.js';
import { getResourceSnapshot, formatResourceReport } from '../monitor/resources.js';

export type Transcriber = (fileUrl: string) => Promise<string>;

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

export class TelegramBot {
  private bot: Telegraf;
  private assistant: Assistant;
  private messageRepo: MessageRepository;
  private configManager: ConfigManager;
  private usageRepo: UsageRepository;
  private transcribe: Transcriber | null;
  private transcriberFactory: (() => Promise<Transcriber | undefined>) | null;
  private lastLanguage: Map<number, string> = new Map(); // chatId → detected language
  private awaitingThresholdInput: Map<number, 'cpu' | 'ram' | 'disk'> = new Map(); // chatId → resource type

  constructor(
    token: string,
    assistant: Assistant,
    messageRepo: MessageRepository,
    configManager: ConfigManager,
    usageRepo: UsageRepository,
    transcribe?: Transcriber,
    transcriberFactory?: () => Promise<Transcriber | undefined>,
  ) {
    this.bot = new Telegraf(token);
    this.assistant = assistant;
    this.messageRepo = messageRepo;
    this.configManager = configManager;
    this.usageRepo = usageRepo;
    this.transcribe = transcribe ?? null;
    this.transcriberFactory = transcriberFactory ?? null;

    this.registerCommands();
    this.registerCallbacks();
    this.registerHandlers();

    this.bot.catch((err) => {
      console.error('Telegraf error:', err);
    });
  }

  private registerCommands(): void {
    this.bot.command('start', async (ctx) => {
      this.captureChatId(ctx.chat.id);
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
      await ctx.sendChatAction('typing');

      const config = this.configManager.getConfig();
      const provider = config.ai.provider;
      const isOAuth = !!(config.ai.authToken);

      try {
        // For local models (openai-compatible without real API) - no usage tracking needed
        if (provider === 'openai-compatible') {
          await ctx.reply(
            '💡 Usage Tracking\n\n'
            + 'You\'re using a local/self-hosted model.\n'
            + 'No usage limits apply - unlimited requests! 🚀'
          );
          return;
        }

        // For Claude OAuth - show link to claude.ai (no programmatic API available)
        if (provider === 'anthropic' && isOAuth) {
          const today = this.usageRepo.getToday();
          const month = this.usageRepo.getMonth();

          await ctx.reply(
            '📈 Usage Statistics\n\n'
            + `**Local stats (this bot):**\n`
            + `Today: ${today.requests} requests\n`
            + `Month: ${month.requests} requests\n\n`
            + '**Full account usage:**\n'
            + 'View your Claude usage and limits:\n'
            + '🔗 https://claude.ai/settings/usage\n\n'
            + '⚠️ If you hit limits, the bot will notify you.',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // For API-based providers - fall back to local tracking for now
        // TODO: Implement direct API calls to provider usage endpoints
        const today = this.usageRepo.getToday();
        const month = this.usageRepo.getMonth();
        await ctx.reply(this.usageRepo.formatReport(provider, today, month, isOAuth));
      } catch (err) {
        console.error('Error getting usage:', err);
        await ctx.reply('Sorry, could not retrieve usage information. Please try again.');
      }
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
  private async sendSettingsMenu(ctx: any): Promise<void> {
    const model = this.configManager.getModel();
    const lang = this.configManager.getLanguage();
    const thresholds = this.configManager.getThresholds();

    await ctx.reply(
      '⚙️ Settings\n\n'
      + `Model: ${model}\n`
      + `Language: ${lang}\n`
      + `CPU alert: ${thresholds.cpuPercent}%\n`
      + `RAM alert: ${thresholds.ramPercent}%\n`
      + `Disk alert: ${thresholds.diskPercent}%`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🧠 Model', 'settings:model')],
        [Markup.button.callback('🌐 Language', 'settings:lang')],
        [Markup.button.callback('📊 CPU threshold', 'settings:cpu')],
        [Markup.button.callback('💾 RAM threshold', 'settings:ram')],
        [Markup.button.callback('💿 Disk threshold', 'settings:disk')],
      ]),
    );
  }

  private registerCallbacks(): void {
    // Model selection
    this.bot.action('settings:model', async (ctx) => {
      await ctx.answerCbQuery();
      const current = this.configManager.getModel();
      await ctx.editMessageText(
        `Current model: ${current}\n\nChoose a new model:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('Claude Opus 4.6', 'model:claude-opus-4-6')],
          [Markup.button.callback('Claude Sonnet 4.5', 'model:claude-sonnet-4-5-20250929')],
          [Markup.button.callback('Claude Haiku 4.5', 'model:claude-haiku-4-5-20251001')],
          [Markup.button.callback('GPT-4o', 'model:gpt-4o')],
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
            [Markup.button.callback('« Back', 'settings:back')],
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

    // Back to settings
    this.bot.action('settings:back', async (ctx) => {
      await ctx.answerCbQuery();
      const model = this.configManager.getModel();
      const lang = this.configManager.getLanguage();
      const thresholds = this.configManager.getThresholds();

      await ctx.editMessageText(
        '⚙️ Settings\n\n'
        + `Model: ${model}\n`
        + `Language: ${lang}\n`
        + `CPU alert: ${thresholds.cpuPercent}%\n`
        + `RAM alert: ${thresholds.ramPercent}%\n`
        + `Disk alert: ${thresholds.diskPercent}%`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🧠 Model', 'settings:model')],
          [Markup.button.callback('🌐 Language', 'settings:lang')],
          [Markup.button.callback('📊 CPU threshold', 'settings:cpu')],
          [Markup.button.callback('💾 RAM threshold', 'settings:ram')],
          [Markup.button.callback('💿 Disk threshold', 'settings:disk')],
        ]),
      );
    });
  }

  private registerHandlers(): void {
    this.bot.on('voice', (ctx) => {
      this.captureChatId(ctx.chat.id);
      this.handleVoice(ctx).catch((err) => console.error('Voice handler error:', err));
    });

    this.bot.on('text', (ctx) => {
      const chatId = ctx.chat.id;
      this.captureChatId(chatId);
      const text = ctx.message.text;

      // Check if we're awaiting threshold input
      if (this.awaitingThresholdInput.has(chatId)) {
        this.handleThresholdInput(ctx, text).catch((err) => console.error('Threshold input error:', err));
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
      const response = await this.assistant.process(userMessage, history);
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
        const isOAuth = !!(config.ai.authToken);

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
