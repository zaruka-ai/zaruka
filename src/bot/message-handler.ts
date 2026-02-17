import type { Telegraf } from 'telegraf';
import type { ChatMessage } from '../core/assistant.js';
import type { BotContext } from './bot-context.js';
import { Markup } from 'telegraf';
import { buildRateLimitMessage } from './providers.js';
import { detectLanguage, splitMessage } from './utils.js';
import { t } from './i18n.js';

/** Convert unsupported Markdown to Telegram-compatible format. */
function toTelegramMarkdown(text: string): string {
  // Convert ### Header, ## Header, # Header → *Header*
  return text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
}

export function registerHandlers(bot: Telegraf, ctx: BotContext): void {
  // "Show more options" button callback — asks assistant to search for more services
  bot.action('more_options', async (tCtx) => {
    await tCtx.answerCbQuery();
    const chatId = tCtx.chat?.id;
    if (!chatId || !ctx.getAssistant()) return;

    const lang = ctx.lastLanguage.get(chatId) || 'English';
    await processAndReply(
      tCtx,
      `[Continue in ${lang}]\nShow more options. Use web_search to find additional image generation services that you haven't mentioned yet.`,
      ctx,
      lang,
    );
  });

  bot.on('voice', (tCtx) => {
    ctx.captureChatId(tCtx.chat.id);
    if (!ctx.getAssistant()) {
      tCtx.reply(t(ctx.configManager, 'error.no_ai')).catch(() => {});
      return;
    }
    handleVoice(tCtx, ctx).catch((err) => console.error('Voice handler error:', err));
  });

  bot.on('text', (tCtx) => {
    const chatId = tCtx.chat.id;
    ctx.captureChatId(chatId);
    const text = tCtx.message.text;

    if (ctx.onboarding.active) {
      ctx.onboarding.handleText(tCtx, text).catch((err) => console.error('Onboarding text error:', err));
      return;
    }

    if (ctx.awaitingLanguageInput.has(chatId)) {
      handleLanguageInput(tCtx, text, ctx).catch((err) => console.error('Language input error:', err));
      return;
    }

    if (ctx.awaitingThresholdInput.has(chatId)) {
      handleThresholdInput(tCtx, text, ctx).catch((err) => console.error('Threshold input error:', err));
      return;
    }

    if (!ctx.getAssistant()) {
      tCtx.reply(t(ctx.configManager, 'error.no_ai')).catch(() => {});
      return;
    }

    const detected = detectLanguage(text);
    if (detected) {
      ctx.lastLanguage.set(chatId, detected);
    }

    let message = text;
    if (!detected && ctx.lastLanguage.has(chatId)) {
      message = `[Continue in ${ctx.lastLanguage.get(chatId)}]\n${text}`;
    }

    const lang = detected || ctx.lastLanguage.get(chatId);
    processAndReply(tCtx, message, ctx, lang).catch((err) => console.error('Text handler error:', err));
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleThresholdInput(tCtx: any, text: string, ctx: BotContext): Promise<void> {
  const chatId = tCtx.chat.id;
  const resource = ctx.awaitingThresholdInput.get(chatId);
  if (!resource) return;

  if (text === '/cancel') {
    ctx.awaitingThresholdInput.delete(chatId);
    await tCtx.reply(t(ctx.configManager, 'cmd.cancel_threshold'));
    return;
  }

  const value = parseInt(text.trim(), 10);
  if (isNaN(value) || value < 1 || value > 100) {
    await tCtx.reply(t(ctx.configManager, 'error.threshold_invalid'));
    return;
  }

  const keyMap = { cpu: 'cpuPercent', ram: 'ramPercent', disk: 'diskPercent' } as const;
  ctx.configManager.updateThreshold(keyMap[resource], value);
  ctx.awaitingThresholdInput.delete(chatId);
  await tCtx.reply(t(ctx.configManager, 'settings.threshold_set', { resource: resource.toUpperCase(), value: String(value) }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleLanguageInput(tCtx: any, text: string, ctx: BotContext): Promise<void> {
  const chatId = tCtx.chat.id;

  if (text === '/cancel') {
    ctx.awaitingLanguageInput.delete(chatId);
    await tCtx.reply(t(ctx.configManager, 'cmd.cancel_done'));
    return;
  }

  const lang = text.trim();
  ctx.awaitingLanguageInput.delete(chatId);
  ctx.configManager.updateLanguage(lang);
  await ctx.refreshTranslations();
  await tCtx.reply(t(ctx.configManager, 'settings.lang_changed', { lang }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleVoice(tCtx: any, ctx: BotContext): Promise<void> {
  if (!ctx.getTranscriber() && ctx.transcriberFactory) {
    try {
      const t = await ctx.transcriberFactory();
      if (t) {
        ctx.setTranscriber(t);
        console.log('Voice transcription: enabled (lazy setup)');
      }
    } catch (err) {
      console.error('Failed to lazy-setup transcriber:', err);
    }
  }

  if (!ctx.getTranscriber()) {
    const duration = tCtx.message.voice.duration;
    await processAndReply(
      tCtx,
      `[The user sent a voice message (${duration}s). Voice transcription is not available. `
      + 'Explain that you received a voice message but cannot listen to it yet. '
      + 'Suggest solutions: the user can set GROQ_API_KEY environment variable (free, https://console.groq.com) '
      + 'or install ffmpeg (brew install ffmpeg / apt install ffmpeg) for local offline transcription. '
      + 'Ask the user to resend the message as text for now.]',
      ctx,
    );
    return;
  }

  try {
    await tCtx.sendChatAction('typing');
    const fileLink = await tCtx.telegram.getFileLink(tCtx.message.voice.file_id);
    const text = await ctx.getTranscriber()!(fileLink.href);
    if (!text) {
      await tCtx.reply(t(ctx.configManager, 'error.voice_transcribe'));
      return;
    }
    const duration = tCtx.message.voice.duration;
    const voiceLang = detectLanguage(text) || ctx.lastLanguage.get(tCtx.chat.id);
    await processAndReply(tCtx, `[The user sent a voice message (${duration}s). It has been automatically transcribed below. Reply to the content naturally, as if the user typed it.]\n${text}`, ctx, voiceLang);
  } catch (err) {
    console.error('Error processing voice message:', err);
    await tCtx.reply(t(ctx.configManager, 'error.voice_failed'));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NOTIFY_DELAY_MS = 8_000;    // Tell the user we're working after 8 s


/**
 * Pool of AI-generated "working on it" messages per language.
 * Generated once on first use, then served from cache.
 */
const workingPool = new Map<string, string[]>();
const pendingGen = new Set<string>();

function pickWorkingMessage(lang: string): string {
  const pool = workingPool.get(lang);
  if (pool && pool.length > 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return '⏳…';
}

/** Generate a pool of "working" messages for a language (fire-and-forget). */
function ensureWorkingPool(lang: string, ctx: BotContext): void {
  if (workingPool.has(lang) || pendingGen.has(lang)) return;
  const assistant = ctx.getAssistant();
  if (!assistant) return;

  pendingGen.add(lang);
  assistant.process(
    `[SYSTEM — not a user message, no greeting, no conversation]\n`
    + `Generate 20 short (2-5 words each) status messages in ${lang} meaning "I'm busy working on your request, please wait". `
    + `The tone: playful, warm, varied (e.g. short phrases like "working on it…", "one moment…", "almost there…" but in ${lang}). `
    + `Each starts with one emoji. All different. One per line, no numbering, no quotes — ONLY the messages.`,
  ).then((text) => {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 1 && l.length < 60);
    if (lines.length >= 5) {
      workingPool.set(lang, lines);
      console.log(`Generated ${lines.length} working messages for ${lang}`);
    }
  }).catch(() => {
    // Will retry on next message
  }).finally(() => {
    pendingGen.delete(lang);
  });
}

/** Track how many AI calls are active per chat. */
const activeTasks = new Map<number, number>();

async function processAndReply(tCtx: any, userMessage: string, ctx: BotContext, msgLang?: string): Promise<void> {
  const chatId: number = tCtx.chat.id;
  console.log(`[chat:${chatId}] User: ${userMessage.slice(0, 100)}${userMessage.length > 100 ? '...' : ''}`);

  // Save user message immediately
  ctx.messageRepo.save(chatId, 'user', userMessage);

  const lang = msgLang || 'English';
  ensureWorkingPool(lang, ctx);

  // Build history; if another task is already running, hint AI not to repeat it
  const recentMessages = ctx.messageRepo.getRecent(chatId, 30);
  const history: ChatMessage[] = recentMessages.map((m) => ({ role: m.role, text: m.text }));
  const busy = (activeTasks.get(chatId) ?? 0) > 0;
  const message = busy
    ? `[CONTEXT: A previous request is still being processed in the background. `
      + `Do NOT repeat, redo, or continue that task. Answer this new message directly and briefly.]\n${userMessage}`
    : userMessage;

  activeTasks.set(chatId, (activeTasks.get(chatId) ?? 0) + 1);

  // "Still working" notification for every message that takes > 8s
  const notifyTimer = setTimeout(async () => {
    try {
      await tCtx.reply(pickWorkingMessage(lang));
    } catch { /* ignore */ }
  }, NOTIFY_DELAY_MS);

  const typingInterval = setInterval(() => {
    tCtx.sendChatAction('typing').catch(() => {});
  }, 4000);

  try {
    await tCtx.sendChatAction('typing');
    const response = await ctx.getAssistant()!.process(message, history);
    clearTimeout(notifyTimer);
    clearInterval(typingInterval);

    if (!response) {
      console.warn(`[chat:${chatId}] Assistant returned empty response for: ${userMessage.slice(0, 60)}`);
    } else {
      console.log(`[chat:${chatId}] Assistant: ${response.slice(0, 100)}${response.length > 100 ? '...' : ''}`);
      ctx.messageRepo.save(chatId, 'assistant', response);
    }

    if (response) {
      let text = response;
      const hasMoreOptions = text.includes('[MORE_OPTIONS]');
      text = text.replace(/\[MORE_OPTIONS\]\s*/g, '').trimEnd();

      const formatted = toTelegramMarkdown(text);
      const chunks = splitMessage(formatted, 4000);
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const extra: Record<string, unknown> = { parse_mode: 'Markdown' };
        if (isLast && hasMoreOptions) {
          extra.reply_markup = Markup.inlineKeyboard([
            [Markup.button.callback('🔍 Show more', 'more_options')],
          ]).reply_markup;
        }
        await tCtx.reply(chunks[i], extra).catch(() => {
          return tCtx.reply(chunks[i]);
        });
      }
    }
  } catch (err) {
    clearTimeout(notifyTimer);
    clearInterval(typingInterval);
    console.error('Error processing message:', err);

    // Walk the error chain to find rate-limit info (RetryError → APICallError)
    const errorMsg = err instanceof Error ? err.message : String(err);
    let fullErrorText = errorMsg;
    if (err instanceof Error) {
      const e = err as Error & { lastError?: Error; responseBody?: string; statusCode?: number };
      if (e.lastError instanceof Error) fullErrorText += ' ' + e.lastError.message;
      if (e.cause instanceof Error) fullErrorText += ' ' + (e.cause as Error).message;
      if (e.responseBody) fullErrorText += ' ' + e.responseBody;
      if (e.statusCode) fullErrorText += ' ' + e.statusCode;
    }
    const isRateLimit = /rate.?limit|quota|limit exceeded|429|RESOURCE_EXHAUSTED/i.test(fullErrorText);

    if (isRateLimit) {
      const config = ctx.configManager.getConfig();
      await tCtx.reply(buildRateLimitMessage(config.ai?.provider, !!config.ai?.authToken, errorMsg));
    } else {
      await tCtx.reply(t(ctx.configManager, 'error.processing'));
    }
  } finally {
    const count = (activeTasks.get(chatId) ?? 1) - 1;
    if (count <= 0) activeTasks.delete(chatId);
    else activeTasks.set(chatId, count);
  }
}
