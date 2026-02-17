import { Markup } from 'telegraf';
import { buildRateLimitMessage } from './providers.js';
import { detectLanguage, splitMessage } from './utils.js';
import { t } from './i18n.js';
/** Convert unsupported Markdown to Telegram-compatible format. */
function toTelegramMarkdown(text) {
    // Convert ### Header, ## Header, # Header → *Header*
    return text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
}
export function registerHandlers(bot, ctx) {
    // "Show more options" button callback — asks assistant to search for more services
    bot.action('more_options', async (tCtx) => {
        await tCtx.answerCbQuery();
        const chatId = tCtx.chat?.id;
        if (!chatId || !ctx.getAssistant())
            return;
        const lang = ctx.lastLanguage.get(chatId) || 'English';
        await processAndReply(tCtx, `[Continue in ${lang}]\nShow more options. Use web_search to find additional image generation services that you haven't mentioned yet.`, ctx);
    });
    bot.on('voice', (tCtx) => {
        ctx.captureChatId(tCtx.chat.id);
        if (!ctx.getAssistant()) {
            tCtx.reply(t(ctx.configManager, 'error.no_ai')).catch(() => { });
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
        processAndReply(tCtx, message, ctx).catch((err) => console.error('Text handler error:', err));
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
        await processAndReply(tCtx, `[The user sent a voice message (${duration}s). It has been automatically transcribed below. Reply to the content naturally, as if the user typed it.]\n${text}`, ctx);
    }
    catch (err) {
        console.error('Error processing voice message:', err);
        await tCtx.reply(t(ctx.configManager, 'error.voice_failed'));
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processAndReply(tCtx, userMessage, ctx) {
    const chatId = tCtx.chat.id;
    console.log(`[chat:${chatId}] User: ${userMessage.slice(0, 100)}${userMessage.length > 100 ? '...' : ''}`);
    const recentMessages = ctx.messageRepo.getRecent(chatId, 20);
    const history = recentMessages.map((m) => ({ role: m.role, text: m.text }));
    const typingInterval = setInterval(() => {
        tCtx.sendChatAction('typing').catch(() => { });
    }, 4000);
    try {
        await tCtx.sendChatAction('typing');
        const response = await ctx.getAssistant().process(userMessage, history);
        clearInterval(typingInterval);
        console.log(`[chat:${chatId}] Assistant: ${response.slice(0, 100)}${response.length > 100 ? '...' : ''}`);
        ctx.messageRepo.save(chatId, 'user', userMessage);
        if (response) {
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
                const extra = { parse_mode: 'Markdown' };
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
    }
    catch (err) {
        clearInterval(typingInterval);
        console.error('Error processing message:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        const isRateLimit = /rate.?limit|quota|limit exceeded|429|RESOURCE_EXHAUSTED/i.test(errorMsg);
        if (isRateLimit) {
            const config = ctx.configManager.getConfig();
            await tCtx.reply(buildRateLimitMessage(config.ai?.provider, !!config.ai?.authToken, errorMsg));
        }
        else {
            await tCtx.reply(t(ctx.configManager, 'error.processing'));
        }
    }
}
//# sourceMappingURL=message-handler.js.map