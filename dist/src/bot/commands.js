import { Markup } from 'telegraf';
import { getResourceSnapshot, formatResourceReport } from '../monitor/resources.js';
import { fmtNum } from '../db/usage-repository.js';
import { getAppVersion } from './utils.js';
import { settingsText, settingsKeyboard } from './settings.js';
import { showTasksList } from './tasks.js';
import { t } from './i18n.js';
export function registerCommands(bot, ctx) {
    const { configManager, usageRepo, onboarding, awaitingThresholdInput } = ctx;
    bot.command('start', async (tCtx) => {
        ctx.captureChatId(tCtx.chat.id);
        if (onboarding.active) {
            await onboarding.sendWelcome(tCtx);
            return;
        }
        await tCtx.reply(t(configManager, 'cmd.start'));
    });
    bot.command('help', async (tCtx) => {
        await tCtx.reply(t(configManager, 'cmd.help'));
    });
    bot.command('version', async (tCtx) => {
        await tCtx.reply(`Zaruka v${getAppVersion()}`);
    });
    bot.command('resources', async (tCtx) => {
        ctx.captureChatId(tCtx.chat.id);
        await tCtx.sendChatAction('typing');
        const snapshot = await getResourceSnapshot();
        await tCtx.reply(formatResourceReport(snapshot));
    });
    bot.command('usage', async (tCtx) => {
        ctx.captureChatId(tCtx.chat.id);
        const config = configManager.getConfig();
        if (!config.ai) {
            await tCtx.reply(t(configManager, 'cmd.usage_no_ai'));
            return;
        }
        if (config.ai.provider === 'openai-compatible') {
            await tCtx.reply(t(configManager, 'cmd.usage_local'));
            return;
        }
        await tCtx.reply(t(configManager, 'cmd.usage_title'), Markup.inlineKeyboard([
            [
                Markup.button.callback(t(configManager, 'period.today'), 'usage:today'),
                Markup.button.callback(t(configManager, 'period.week'), 'usage:week'),
            ],
            [
                Markup.button.callback(t(configManager, 'period.month'), 'usage:month'),
                Markup.button.callback(t(configManager, 'period.year'), 'usage:year'),
            ],
        ]));
    });
    bot.command('settings', async (tCtx) => {
        ctx.captureChatId(tCtx.chat.id);
        await tCtx.reply(settingsText(configManager), settingsKeyboard(configManager));
    });
    bot.command('tasks', async (tCtx) => {
        ctx.captureChatId(tCtx.chat.id);
        await showTasksList(tCtx, ctx);
    });
    bot.command('cancel', async (tCtx) => {
        const chatId = tCtx.chat.id;
        if (awaitingThresholdInput.has(chatId)) {
            awaitingThresholdInput.delete(chatId);
            await tCtx.reply(t(configManager, 'cmd.cancel_done'));
        }
        else if (ctx.awaitingLanguageInput.has(chatId)) {
            ctx.awaitingLanguageInput.delete(chatId);
            await tCtx.reply(t(configManager, 'cmd.cancel_done'));
        }
        else {
            await tCtx.reply(t(configManager, 'cmd.cancel_nothing'));
        }
    });
}
/** Map period param to i18n key. */
const PERIOD_KEYS = {
    today: 'period.today',
    week: 'period.week',
    month: 'period.month',
    year: 'period.year',
};
export function registerUsageCallbacks(bot, ctx) {
    const { configManager, usageRepo } = ctx;
    bot.action(/^usage:(today|week|month|year)$/, async (tCtx) => {
        await tCtx.answerCbQuery();
        const period = tCtx.match[1];
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback(t(configManager, 'period.today'), 'usage:today'),
                Markup.button.callback(t(configManager, 'period.week'), 'usage:week'),
            ],
            [
                Markup.button.callback(t(configManager, 'period.month'), 'usage:month'),
                Markup.button.callback(t(configManager, 'period.year'), 'usage:year'),
            ],
        ]);
        try {
            const { UsageRepository } = await import('../db/usage-repository.js');
            const { from, to } = UsageRepository.getDateRange(period);
            const periodLabel = t(configManager, PERIOD_KEYS[period]);
            const summary = usageRepo.getByRange(from, to);
            if (summary.requests === 0) {
                try {
                    const header = t(configManager, 'cmd.usage_header', { period: periodLabel });
                    await tCtx.editMessageText(`${header}\n\n${t(configManager, 'cmd.usage_no_data')}`, keyboard);
                }
                catch { /* ignore */ }
                return;
            }
            const header = t(configManager, 'cmd.usage_header', { period: periodLabel });
            const lines = [header, ''];
            lines.push(`${t(configManager, 'cmd.usage_requests')}: ${summary.requests}`);
            lines.push(`${t(configManager, 'cmd.usage_input')}: ${fmtNum(summary.input_tokens)}`);
            lines.push(`${t(configManager, 'cmd.usage_output')}: ${fmtNum(summary.output_tokens)}`);
            lines.push(`${t(configManager, 'cmd.usage_total')}: ${fmtNum(summary.total_tokens)}`);
            const breakdown = usageRepo.getModelBreakdown(from, to);
            if (breakdown.length > 0) {
                lines.push('', `${t(configManager, 'cmd.usage_per_model')}:`);
                for (const m of breakdown) {
                    lines.push(`  ${m.model}: ${fmtNum(m.input_tokens + m.output_tokens)} tok (${m.requests} req)`);
                }
            }
            try {
                await tCtx.editMessageText(lines.join('\n'), keyboard);
            }
            catch { /* message might be identical */ }
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error('Usage load failed:', errMsg);
            try {
                await tCtx.editMessageText(t(configManager, 'cmd.usage_failed', { error: errMsg }), keyboard);
            }
            catch { /* ignore */ }
        }
    });
}
//# sourceMappingURL=commands.js.map