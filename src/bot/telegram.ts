import { Telegraf } from 'telegraf';
import type { Assistant } from '../core/assistant.js';
import type { MessageRepository } from '../db/message-repository.js';
import type { ConfigManager } from '../core/config-manager.js';
import type { UsageRepository } from '../db/usage-repository.js';
import type { AiProvider } from '../core/types.js';
import type { TaskRepository } from '../db/repository.js';
import type { BotContext } from './bot-context.js';
import { OnboardingHandler } from './onboarding/handler.js';
import { registerCommands, registerUsageCallbacks } from './commands.js';
import { registerSettingsCallbacks } from './settings.js';
import { registerTasksCallbacks } from './tasks.js';
import { registerHandlers } from './message-handler.js';
import { getAppVersion } from './utils.js';
import { t } from './i18n.js';

export type { Transcriber } from './bot-context.js';

export class TelegramBot {
  private bot: Telegraf;
  private assistant: Assistant | null;
  private configManager: ConfigManager;
  private onboarding: OnboardingHandler;

  constructor(
    token: string,
    assistant: Assistant | null,
    messageRepo: MessageRepository,
    configManager: ConfigManager,
    usageRepo: UsageRepository,
    taskRepo: TaskRepository,
    transcribe?: (fileUrl: string) => Promise<string>,
    transcriberFactory?: () => Promise<((fileUrl: string) => Promise<string>) | undefined>,
    onSetupComplete?: () => Promise<void>,
    refreshTranslations?: () => Promise<void>,
  ) {
    this.bot = new Telegraf(token);
    this.assistant = assistant;
    this.configManager = configManager;

    let _transcribe = transcribe ?? null;

    this.onboarding = new OnboardingHandler(
      {
        configManager,
        onSetupComplete,
        onOnboardingComplete: async (tCtx) => {
          if (!this.assistant) return;
          try {
            await tCtx.sendChatAction('typing');
            const response = await this.assistant.process('👋');
            if (response) {
              const formatted = response.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
              await tCtx.reply(formatted, { parse_mode: 'Markdown' }).catch(() => tCtx.reply(formatted));
            }
          } catch (err) {
            console.error('AI greeting failed:', err);
          }
        },
      },
      !assistant,
    );

    const ctx: BotContext = {
      configManager,
      messageRepo,
      usageRepo,
      taskRepo,
      getAssistant: () => this.assistant,
      getTranscriber: () => _transcribe,
      setTranscriber: (t) => { _transcribe = t; },
      transcriberFactory: transcriberFactory ?? null,
      onboarding: this.onboarding,
      lastLanguage: new Map(),
      awaitingThresholdInput: new Map(),
      awaitingLanguageInput: new Set(),
      captureChatId: (chatId) => {
        if (!configManager.getChatId()) {
          configManager.setChatId(chatId);
          console.log(`Chat ID captured: ${chatId}`);
        }
      },
      clearAssistant: () => { this.assistant = null; },
      rebuildAssistant: async () => {
        if (onSetupComplete) await onSetupComplete();
      },
      refreshTranslations: refreshTranslations ?? (async () => {}),
    };

    registerCommands(this.bot, ctx);
    registerSettingsCallbacks(this.bot, ctx);
    registerUsageCallbacks(this.bot, ctx);
    registerTasksCallbacks(this.bot, ctx);
    this.registerOnboardingCallbacks();
    registerHandlers(this.bot, ctx);

    this.bot.catch((err) => {
      console.error('Telegraf error:', err);
    });
  }

  setAssistant(assistant: Assistant): void {
    this.assistant = assistant;
  }

  /** Update Telegram bot command descriptions using translated strings. */
  async updateCommands(): Promise<void> {
    await this.bot.telegram.setMyCommands([
      { command: 'start', description: t(this.configManager, 'cmd_desc.start') },
      { command: 'settings', description: t(this.configManager, 'cmd_desc.settings') },
      { command: 'tasks', description: t(this.configManager, 'cmd_desc.tasks') },
      { command: 'usage', description: t(this.configManager, 'cmd_desc.usage') },
      { command: 'resources', description: t(this.configManager, 'cmd_desc.resources') },
      { command: 'version', description: t(this.configManager, 'cmd_desc.version') },
      { command: 'help', description: t(this.configManager, 'cmd_desc.help') },
    ]);
  }

  /** Check onboarding state; if expired, notify the user and return true (handled). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async staleGuard(ctx: any): Promise<boolean> {
    if (!this.onboarding.active) {
      await ctx.answerCbQuery('Session expired. Use /settings to try again.');
      return true;
    }
    return false;
  }

  private registerOnboardingCallbacks(): void {
    this.bot.action(/^onboard_lang:(.+)$/, async (ctx) => {
      if (await this.staleGuard(ctx)) return;
      await ctx.answerCbQuery();
      await this.onboarding.handleLanguageSelected(ctx, ctx.match[1]);
    });

    this.bot.action(/^onboard:(anthropic|openai|google|deepseek|groq|xai|openai-compatible)$/, async (ctx) => {
      if (await this.staleGuard(ctx)) return;
      await ctx.answerCbQuery();
      await this.onboarding.handleProviderSelected(ctx, ctx.match[1] as AiProvider);
    });

    this.bot.action(/^onboard_auth:(api_key|oauth)$/, async (ctx) => {
      if (await this.staleGuard(ctx)) return;
      await ctx.answerCbQuery();
      await this.onboarding.handleAuthMethod(ctx, ctx.match[1] as 'api_key' | 'oauth');
    });

    this.bot.action(/^onboard_model:(.+)$/, async (ctx) => {
      if (await this.staleGuard(ctx)) return;
      await ctx.answerCbQuery();
      await this.onboarding.handleModelSelected(ctx, ctx.match[1]);
    });

    this.bot.action('onboard_models_all', async (ctx) => {
      if (await this.staleGuard(ctx)) return;
      await ctx.answerCbQuery();
      await this.onboarding.handleShowAllModels(ctx);
    });

    this.bot.action('onboard_back_provider', async (ctx) => {
      if (await this.staleGuard(ctx)) return;
      await ctx.answerCbQuery();
      await this.onboarding.handleBackToProvider(ctx);
    });

    this.bot.action('onboard:retry', async (ctx) => {
      await ctx.answerCbQuery();
      await this.onboarding.handleRetry(ctx);
    });

  }

  getSendMessageFn(): (message: string) => Promise<void> {
    return async (message: string) => {
      const chatId = this.configManager.getChatId();
      if (!chatId) {
        console.warn('Cannot send message: no chat ID captured yet.');
        return;
      }
      await this.bot.telegram.sendMessage(chatId, message);
    };
  }

  async start(): Promise<void> {
    await this.updateCommands();

    const version = getAppVersion();
    console.log(`Zaruka v${version}`);
    console.log('Telegram bot starting (polling mode)...');

    // Retry launch on 409 Conflict — the previous instance's long-poll
    // may linger during Docker restarts until the old connection dies.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.bot.launch();
        break;
      } catch (err) {
        const is409 = err instanceof Error && err.message.includes('409');
        if (!is409) throw err;
        if (attempt === 1) {
          console.log('Waiting for previous polling session to release...');
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    console.log('Telegram bot is running.');

    const shutdown = () => { this.bot.stop('SIGINT'); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }

  stop(): void {
    this.bot.stop();
  }
}
