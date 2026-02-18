import { Markup } from 'telegraf';
import { buildRateLimitMessage } from './providers.js';
import { closeUnclosedCodeFences, detectLanguage, splitMessage } from './utils.js';
import { t } from './i18n.js';
/** Convert unsupported Markdown to Telegram-compatible format. */
function toTelegramMarkdown(text) {
    // Convert ### Header, ## Header, # Header → *Header*
    return text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
}
/** Dedup: remember recently processed message IDs to ignore re-delivered updates after restarts. */
const processedMessages = new Set();
const DEDUP_MAX = 200;
function isDuplicate(chatId, messageId) {
    const key = `${chatId}:${messageId}`;
    if (processedMessages.has(key))
        return true;
    processedMessages.add(key);
    // Evict oldest entries when the set grows too large
    if (processedMessages.size > DEDUP_MAX) {
        const first = processedMessages.values().next().value;
        processedMessages.delete(first);
    }
    return false;
}
export function registerHandlers(bot, ctx) {
    // "Show more options" button callback — asks assistant to search for more services
    bot.action('more_options', async (tCtx) => {
        await tCtx.answerCbQuery();
        const chatId = tCtx.chat?.id;
        if (!chatId || !ctx.getAssistant())
            return;
        const lang = ctx.lastLanguage.get(chatId) || 'English';
        await processAndReply(tCtx, `[Continue in ${lang}]\nShow more options. Use web_search to find additional image generation services that you haven't mentioned yet.`, ctx, lang);
    });
    bot.on('voice', (tCtx) => {
        if (isDuplicate(tCtx.chat.id, tCtx.message.message_id))
            return;
        ctx.captureChatId(tCtx.chat.id);
        if (!ctx.getAssistant()) {
            tCtx.reply(t(ctx.configManager, 'error.no_ai')).catch(() => { });
            return;
        }
        handleVoice(tCtx, ctx).catch((err) => console.error('Voice handler error:', err));
    });
    bot.on('text', (tCtx) => {
        const chatId = tCtx.chat.id;
        if (isDuplicate(chatId, tCtx.message.message_id))
            return;
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
            tCtx.reply(t(ctx.configManager, 'error.no_ai')).catch(() => { });
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
async function handleThresholdInput(tCtx, text, ctx) {
    const chatId = tCtx.chat.id;
    const resource = ctx.awaitingThresholdInput.get(chatId);
    if (!resource)
        return;
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
    const keyMap = { cpu: 'cpuPercent', ram: 'ramPercent', disk: 'diskPercent' };
    ctx.configManager.updateThreshold(keyMap[resource], value);
    ctx.awaitingThresholdInput.delete(chatId);
    await tCtx.reply(t(ctx.configManager, 'settings.threshold_set', { resource: resource.toUpperCase(), value: String(value) }));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleLanguageInput(tCtx, text, ctx) {
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
async function handleVoice(tCtx, ctx) {
    if (!ctx.getTranscriber() && ctx.transcriberFactory) {
        try {
            const t = await ctx.transcriberFactory();
            if (t) {
                ctx.setTranscriber(t);
                console.log('Voice transcription: enabled (lazy setup)');
            }
        }
        catch (err) {
            console.error('Failed to lazy-setup transcriber:', err);
        }
    }
    if (!ctx.getTranscriber()) {
        const duration = tCtx.message.voice.duration;
        await processAndReply(tCtx, `[The user sent a voice message (${duration}s). Voice transcription is not available. `
            + 'Explain that you received a voice message but cannot listen to it yet. '
            + 'Suggest solutions: the user can set GROQ_API_KEY environment variable (free, https://console.groq.com) '
            + 'or install ffmpeg (brew install ffmpeg / apt install ffmpeg) for local offline transcription. '
            + 'Ask the user to resend the message as text for now.]', ctx);
        return;
    }
    try {
        await tCtx.sendChatAction('typing');
        const fileLink = await tCtx.telegram.getFileLink(tCtx.message.voice.file_id);
        const text = await ctx.getTranscriber()(fileLink.href);
        if (!text) {
            await tCtx.reply(t(ctx.configManager, 'error.voice_transcribe'));
            return;
        }
        const duration = tCtx.message.voice.duration;
        const voiceLang = detectLanguage(text) || ctx.lastLanguage.get(tCtx.chat.id);
        await processAndReply(tCtx, `[The user sent a voice message (${duration}s). It has been automatically transcribed below. Reply to the content naturally, as if the user typed it.]\n${text}`, ctx, voiceLang);
    }
    catch (err) {
        console.error('Error processing voice message:', err);
        await tCtx.reply(t(ctx.configManager, 'error.voice_failed'));
    }
}
/**
 * Pool of AI-generated "working on it" messages per language.
 * Generated once on first use, then served from cache.
 */
const workingPool = new Map();
const pendingGen = new Set();
function pickWorkingMessage(lang) {
    const pool = workingPool.get(lang);
    if (pool && pool.length > 0) {
        return pool[Math.floor(Math.random() * pool.length)];
    }
    return '⏳…';
}
/** Generate a pool of "working" messages for a language (fire-and-forget). */
function ensureWorkingPool(lang, ctx) {
    if (workingPool.has(lang) || pendingGen.has(lang))
        return;
    const assistant = ctx.getAssistant();
    if (!assistant)
        return;
    pendingGen.add(lang);
    assistant.process(`[SYSTEM — not a user message, no greeting, no conversation]\n`
        + `Generate 20 short (2-5 words each) status messages in ${lang} meaning "I'm busy working on your request, please wait". `
        + `The tone: playful, warm, varied (e.g. short phrases like "working on it…", "one moment…", "almost there…" but in ${lang}). `
        + `Each starts with one emoji. All different. One per line, no numbering, no quotes — ONLY the messages.`).then((text) => {
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
/** Max length for a single Telegram message before splitting. */
const SPLIT_THRESHOLD = 3800;
/** Minimum interval between editMessageText calls (ms). */
const EDIT_THROTTLE_MS = 1500;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class TelegramStreamWriter {
    tCtx;
    chatId;
    messageId = null;
    buffer = '';
    editTimer = null;
    typingTimer = null;
    lastEditText = '';
    finalizedMessages = [];
    constructor(tCtx) {
        this.tCtx = tCtx;
        this.chatId = tCtx.chat.id;
    }
    /** Send the initial "working" message and start timers. */
    async start(initialText) {
        const sent = await this.tCtx.reply(initialText);
        this.messageId = sent.message_id;
        this.typingTimer = setInterval(() => {
            this.tCtx.sendChatAction('typing').catch(() => { });
        }, 4000);
        this.editTimer = setInterval(() => {
            this.flushEdit().catch(() => { });
        }, EDIT_THROTTLE_MS);
    }
    /** Called for each text delta from the stream. */
    onDelta(delta) {
        this.buffer += delta;
    }
    /** Throttled edit — sends current buffer to Telegram. */
    async flushEdit() {
        if (!this.messageId || !this.buffer || this.buffer === this.lastEditText)
            return;
        // If the buffer exceeds the split threshold, finalize the current message
        // and start a new one for the overflow.
        if (this.buffer.length > SPLIT_THRESHOLD) {
            // Find a good split point
            const splitAt = this.buffer.lastIndexOf('\n', SPLIT_THRESHOLD);
            const cutAt = (splitAt > SPLIT_THRESHOLD / 2) ? splitAt : SPLIT_THRESHOLD;
            const head = this.buffer.slice(0, cutAt);
            const tail = this.buffer.slice(cutAt);
            // Finalize the current message with the head portion
            await this.editMessage(this.messageId, closeUnclosedCodeFences(toTelegramMarkdown(head)));
            this.finalizedMessages.push(this.messageId);
            // Start a new message for the rest
            const sent = await this.tCtx.reply('…');
            this.messageId = sent.message_id;
            this.buffer = tail;
            this.lastEditText = '';
            return;
        }
        const display = closeUnclosedCodeFences(toTelegramMarkdown(this.buffer));
        await this.editMessage(this.messageId, display);
        this.lastEditText = this.buffer;
    }
    /** Final edit with the authoritative complete text from the SDK. */
    async finish(finalText) {
        this.stopTimers();
        const hasMoreOptions = finalText.includes('[MORE_OPTIONS]');
        const cleaned = finalText.replace(/\[MORE_OPTIONS\]\s*/g, '').trimEnd();
        const formatted = toTelegramMarkdown(cleaned);
        const chunks = splitMessage(formatted, 4000);
        // Edit the first message with the first chunk (or a finalized message's content)
        // If there were finalized messages, they already have their content. We need to
        // handle the case where the final text differs from the streamed buffer.
        // Strategy: edit ALL finalized messages away isn't practical, so we just
        // edit the current active message with the final text, split as needed.
        if (chunks.length === 1 && this.finalizedMessages.length === 0) {
            // Simple case: everything fits in the one message
            const extra = { parse_mode: 'Markdown' };
            if (hasMoreOptions) {
                extra.reply_markup = Markup.inlineKeyboard([
                    [Markup.button.callback('🔍 Show more', 'more_options')],
                ]).reply_markup;
            }
            if (this.messageId) {
                await this.editMessage(this.messageId, chunks[0], extra);
            }
        }
        else {
            // Multi-chunk: edit current message with first remaining chunk, send rest as new
            // First, handle existing finalized messages — they already contain streamed content
            // that is close to final. We only need to handle the current active message and
            // any additional chunks beyond what's already sent.
            // Re-split the full final text and distribute across all messages
            const allMsgIds = [...this.finalizedMessages, this.messageId];
            for (let i = 0; i < chunks.length; i++) {
                const isLast = i === chunks.length - 1;
                const extra = { parse_mode: 'Markdown' };
                if (isLast && hasMoreOptions) {
                    extra.reply_markup = Markup.inlineKeyboard([
                        [Markup.button.callback('🔍 Show more', 'more_options')],
                    ]).reply_markup;
                }
                if (i < allMsgIds.length) {
                    // Edit existing message
                    await this.editMessage(allMsgIds[i], chunks[i], extra);
                }
                else {
                    // Send new message for overflow chunks
                    await this.tCtx.reply(chunks[i], extra).catch(() => {
                        return this.tCtx.reply(chunks[i]);
                    });
                }
            }
        }
        return { hasMoreOptions };
    }
    /** Edit message with error text on failure. */
    async abort(errorText) {
        this.stopTimers();
        if (this.messageId) {
            try {
                await this.tCtx.telegram.editMessageText(this.chatId, this.messageId, undefined, errorText);
            }
            catch {
                await this.tCtx.reply(errorText).catch(() => { });
            }
        }
        else {
            await this.tCtx.reply(errorText).catch(() => { });
        }
    }
    async editMessage(msgId, text, extra) {
        try {
            await this.tCtx.telegram.editMessageText(this.chatId, msgId, undefined, text, { parse_mode: 'Markdown', ...extra });
        }
        catch {
            // Markdown failed — retry without parse_mode
            try {
                await this.tCtx.telegram.editMessageText(this.chatId, msgId, undefined, text, extra ?? {});
            }
            catch { /* ignore — message unchanged or deleted */ }
        }
    }
    stopTimers() {
        if (this.editTimer) {
            clearInterval(this.editTimer);
            this.editTimer = null;
        }
        if (this.typingTimer) {
            clearInterval(this.typingTimer);
            this.typingTimer = null;
        }
    }
}
/** Track how many AI calls are active per chat. */
const activeTasks = new Map();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processAndReply(tCtx, userMessage, ctx, msgLang) {
    const chatId = tCtx.chat.id;
    console.log(`[chat:${chatId}] User: ${userMessage.slice(0, 100)}${userMessage.length > 100 ? '...' : ''}`);
    // Save user message immediately
    ctx.messageRepo.save(chatId, 'user', userMessage);
    const lang = msgLang || 'English';
    ensureWorkingPool(lang, ctx);
    // Build history; if another task is already running, hint AI not to repeat it
    const recentMessages = ctx.messageRepo.getRecent(chatId, 4);
    const history = recentMessages.map((m) => ({ role: m.role, text: m.text }));
    const busy = (activeTasks.get(chatId) ?? 0) > 0;
    const message = busy
        ? `[CONTEXT: A previous request is still being processed in the background. `
            + `Do NOT repeat, redo, or continue that task. Answer this new message directly and briefly.]\n${userMessage}`
        : userMessage;
    activeTasks.set(chatId, (activeTasks.get(chatId) ?? 0) + 1);
    const writer = new TelegramStreamWriter(tCtx);
    try {
        await writer.start(pickWorkingMessage(lang));
        const response = await ctx.getAssistant().processStream(message, history, { onTextDelta: (d) => writer.onDelta(d) });
        if (!response) {
            console.warn(`[chat:${chatId}] Assistant returned empty response for: ${userMessage.slice(0, 60)}`);
            // Save a placeholder so the unanswered user message doesn't cause
            // the model to re-attempt it on the next turn.
            ctx.messageRepo.save(chatId, 'assistant', '[error: failed to generate a response]');
            await writer.abort(t(ctx.configManager, 'error.processing'));
        }
        else {
            console.log(`[chat:${chatId}] Assistant: ${response.slice(0, 100)}${response.length > 100 ? '...' : ''}`);
            ctx.messageRepo.save(chatId, 'assistant', response);
            await writer.finish(response);
        }
    }
    catch (err) {
        console.error('Error processing message:', err);
        ctx.messageRepo.save(chatId, 'assistant', '[error: failed to generate a response]');
        // Walk the error chain to find rate-limit info (RetryError → APICallError)
        const errorMsg = err instanceof Error ? err.message : String(err);
        let fullErrorText = errorMsg;
        if (err instanceof Error) {
            const e = err;
            if (e.lastError instanceof Error)
                fullErrorText += ' ' + e.lastError.message;
            if (e.cause instanceof Error)
                fullErrorText += ' ' + e.cause.message;
            if (e.responseBody)
                fullErrorText += ' ' + e.responseBody;
            if (e.statusCode)
                fullErrorText += ' ' + e.statusCode;
        }
        const isRateLimit = /rate.?limit|quota|limit exceeded|429|RESOURCE_EXHAUSTED/i.test(fullErrorText);
        if (isRateLimit) {
            const config = ctx.configManager.getConfig();
            await writer.abort(buildRateLimitMessage(config.ai?.provider, !!config.ai?.authToken, errorMsg));
        }
        else {
            await writer.abort(t(ctx.configManager, 'error.processing'));
        }
    }
    finally {
        const count = (activeTasks.get(chatId) ?? 1) - 1;
        if (count <= 0)
            activeTasks.delete(chatId);
        else
            activeTasks.set(chatId, count);
    }
}
//# sourceMappingURL=message-handler.js.map