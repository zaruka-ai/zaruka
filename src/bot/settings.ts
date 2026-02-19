import { Markup, type Telegraf } from 'telegraf';
import type { ConfigManager } from '../core/config-manager.js';
import type { AiProvider } from '../core/types.js';
import type { BotContext } from './bot-context.js';
import { fetchAvailableModels, clearModelsCache } from './models.js';
import { settingsProviderKeyboard, PROVIDER_LABELS } from './providers.js';
import { showModelList } from './model-keyboard.js';
import { languageKeyboardRows, languageDisplayName } from './utils.js';
import { forceTokenRefresh } from '../auth/token-refresh.js';
import { t } from './i18n.js';

/** Per-chat: which provider the user is currently browsing models for. */
const browsingProvider = new Map<number, AiProvider>();

export function settingsText(configManager: ConfigManager): string {
  const model = configManager.getModel();
  const rawLang = configManager.getLanguage();
  const lang = rawLang === 'auto' ? t(configManager, 'settings.lang_auto') : languageDisplayName(rawLang);
  const alertsEnabled = configManager.isResourceMonitorEnabled();
  const onOff = alertsEnabled ? t(configManager, 'settings.on') : t(configManager, 'settings.off');
  return t(configManager, 'settings.title') + '\n\n'
    + `${t(configManager, 'settings.model_label')}: ${model}\n`
    + `${t(configManager, 'settings.language_label')}: ${lang}\n`
    + `${t(configManager, 'settings.alerts_label')}: ${onOff}`;
}

export function settingsKeyboard(configManager: ConfigManager) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t(configManager, 'settings.model_btn'), 'settings:model')],
    [Markup.button.callback(t(configManager, 'settings.lang_btn'), 'settings:lang')],
    [Markup.button.callback(t(configManager, 'settings.resources_btn'), 'settings:resources')],
    [Markup.button.callback(t(configManager, 'settings.reset_btn'), 'settings:reset')],
  ]);
}

function resourcesText(configManager: ConfigManager): string {
  const thresholds = configManager.getThresholds();
  const alertsEnabled = configManager.isResourceMonitorEnabled();
  const onOff = alertsEnabled ? t(configManager, 'settings.on') : t(configManager, 'settings.off');
  return t(configManager, 'settings.resources_title') + '\n\n'
    + `${t(configManager, 'settings.alerts_status')}: ${onOff}\n`
    + `${t(configManager, 'settings.cpu_label')}: ${thresholds.cpuPercent}%\n`
    + `${t(configManager, 'settings.ram_label')}: ${thresholds.ramPercent}%\n`
    + `${t(configManager, 'settings.disk_label')}: ${thresholds.diskPercent}%`;
}

function resourcesKeyboard(configManager: ConfigManager) {
  const alertsEnabled = configManager.isResourceMonitorEnabled();
  const onOff = alertsEnabled ? t(configManager, 'settings.on') : t(configManager, 'settings.off');
  return Markup.inlineKeyboard([
    [Markup.button.callback(t(configManager, 'settings.alerts_toggle', { status: onOff }), 'settings:toggle_alerts')],
    [Markup.button.callback(t(configManager, 'settings.cpu_btn'), 'settings:cpu')],
    [Markup.button.callback(t(configManager, 'settings.ram_btn'), 'settings:ram')],
    [Markup.button.callback(t(configManager, 'settings.disk_btn'), 'settings:disk')],
    [Markup.button.callback(t(configManager, 'settings.back'), 'settings:back')],
  ]);
}

const MODEL_LIST_OPTS = {
  modelPrefix: 'model:',
  showAllAction: 'models_all',
  backAction: 'settings:model',
} as const;

/** Build model list keyboard for a given provider config. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showModelsForProvider(tCtx: any, provider: AiProvider, configManager: ConfigManager) {
  const saved = configManager.getSavedProvider(provider);
  const current = configManager.getConfig().ai;
  let ai = provider === current?.provider ? current : saved;

  if (!ai) return; // shouldn't happen — caller checks

  await tCtx.editMessageText(`${PROVIDER_LABELS[provider]}\n\n${t(configManager, 'settings.loading_models')}`);

  let found = await showModelList(tCtx, ai, configManager, MODEL_LIST_OPTS);

  // If fetch failed and this provider uses OAuth, try refreshing the token and retrying
  if (!found && ai.authToken) {
    console.log(`[Settings] Model fetch failed for ${provider}, attempting token refresh...`);
    const refreshed = await forceTokenRefresh(configManager, provider);
    if (refreshed) {
      // Re-read config — token was updated
      const refreshedCurrent = configManager.getConfig().ai;
      ai = provider === refreshedCurrent?.provider ? refreshedCurrent : configManager.getSavedProvider(provider);
      if (ai) {
        found = await showModelList(tCtx, ai, configManager, MODEL_LIST_OPTS);
      }
    }
  }

  if (!found) {
    const isOAuth = !!ai?.authToken;
    const buttons = [];
    if (isOAuth) {
      buttons.push([Markup.button.callback(t(configManager, 'settings.reauth_btn') || 'Re-authenticate', `settings:reauth:${provider}`)]);
    }
    buttons.push([Markup.button.callback(t(configManager, 'settings.back'), 'settings:model')]);

    const message = isOAuth
      ? t(configManager, 'settings.auth_expired') || 'Authorization may have expired. Please re-authenticate.'
      : 'Could not fetch models.';

    await tCtx.editMessageText(
      `${PROVIDER_LABELS[provider]}\n\n${message}`,
      Markup.inlineKeyboard(buttons),
    );
  }
}

export function registerSettingsCallbacks(bot: Telegraf, ctx: BotContext): void {
  const { configManager, onboarding, awaitingThresholdInput } = ctx;

  // Model — show provider list
  bot.action('settings:model', async (tCtx) => {
    await tCtx.answerCbQuery();
    const currentProvider = configManager.getConfig().ai?.provider;
    await tCtx.editMessageText(t(configManager, 'settings.choose_provider'), settingsProviderKeyboard(currentProvider));
  });

  // Provider selected — show models or start onboarding
  bot.action(/^settings:provider:(.+)$/, async (tCtx) => {
    await tCtx.answerCbQuery();
    const provider = tCtx.match[1] as AiProvider;
    const chatId = tCtx.chat!.id;
    const current = configManager.getConfig().ai;

    const hasCreds = provider === current?.provider || !!configManager.getSavedProvider(provider);

    if (hasCreds) {
      browsingProvider.set(chatId, provider);
      await showModelsForProvider(tCtx, provider, configManager);
    } else {
      // No saved credentials — collect them via onboarding auth flow, but skip profile questions
      onboarding.state = { step: 'provider', provider, skipProfile: true };
      clearModelsCache();
      await onboarding.handleProviderSelected(tCtx, provider);
    }
  });

  // Re-authenticate a provider whose token expired
  bot.action(/^settings:reauth:(.+)$/, async (tCtx) => {
    await tCtx.answerCbQuery();
    const provider = tCtx.match[1] as AiProvider;
    onboarding.state = { step: 'provider', provider, skipProfile: true };
    clearModelsCache();
    await onboarding.handleProviderSelected(tCtx, provider);
  });

  // Show all models for the browsing provider
  bot.action('models_all', async (tCtx) => {
    await tCtx.answerCbQuery();
    const chatId = tCtx.chat!.id;
    const provider = browsingProvider.get(chatId) ?? configManager.getConfig().ai?.provider;
    if (!provider) return;

    const saved = configManager.getSavedProvider(provider);
    const current = configManager.getConfig().ai;
    const ai = provider === current?.provider ? current : saved;
    if (!ai) return;

    const { all } = await fetchAvailableModels(ai);
    const currentModel = configManager.getModel();
    const modelButtons = all.map((m) => {
      const check = m.id === currentModel && provider === current?.provider ? ' ✓' : '';
      return [Markup.button.callback(`${m.label}${check}`, `model:${m.id}`)];
    });

    await tCtx.editMessageText(
      `${PROVIDER_LABELS[provider]}\n\n${t(configManager, 'settings.choose_model')}`,
      Markup.inlineKeyboard([
        ...modelButtons,
        [Markup.button.callback(t(configManager, 'settings.back'), 'settings:model')],
      ]),
    );
  });

  // Model selected — switch provider if needed
  bot.action(/^model:(.+)$/, async (tCtx) => {
    await tCtx.answerCbQuery();
    const model = tCtx.match[1];
    const chatId = tCtx.chat!.id;
    const targetProvider = browsingProvider.get(chatId);
    const currentProvider = configManager.getConfig().ai?.provider;

    if (targetProvider && targetProvider !== currentProvider) {
      // Switching to a different provider
      const saved = configManager.getSavedProvider(targetProvider);
      if (saved) {
        configManager.updateAiConfig({ ...saved, model });
        clearModelsCache();
        await ctx.rebuildAssistant();
        await tCtx.editMessageText(
          t(configManager, 'settings.switched', { provider: PROVIDER_LABELS[targetProvider], model }),
        );
      }
    } else {
      configManager.updateModel(model);
      await ctx.rebuildAssistant();
      await tCtx.editMessageText(t(configManager, 'settings.model_changed', { model }));
    }

    browsingProvider.delete(chatId);
  });

  // Language
  bot.action('settings:lang', async (tCtx) => {
    await tCtx.answerCbQuery();
    const rawLang = configManager.getLanguage();
    const current = rawLang === 'auto' ? t(configManager, 'settings.lang_auto') : languageDisplayName(rawLang);
    await tCtx.editMessageText(
      t(configManager, 'settings.lang_prompt', { lang: current }),
      Markup.inlineKeyboard([
        [Markup.button.callback(t(configManager, 'settings.lang_auto'), 'lang:auto')],
        ...languageKeyboardRows('lang:'),
        [Markup.button.callback(t(configManager, 'settings.lang_other'), 'lang:custom')],
        [Markup.button.callback(t(configManager, 'settings.back'), 'settings:back')],
      ]),
    );
  });

  bot.action('lang:custom', async (tCtx) => {
    await tCtx.answerCbQuery();
    ctx.awaitingLanguageInput.add(tCtx.chat!.id);
    await tCtx.editMessageText(t(configManager, 'settings.lang_custom_prompt'));
  });

  bot.action(/^lang:(.+)$/, async (tCtx) => {
    await tCtx.answerCbQuery();
    const lang = tCtx.match[1];
    configManager.updateLanguage(lang);
    await ctx.refreshTranslations();
    await tCtx.editMessageText(t(configManager, 'settings.lang_changed', { lang: languageDisplayName(lang) }));
  });

  // Thresholds
  const thresholdKeys = [
    ['cpu', 'CPU'],
    ['ram', 'RAM'],
    ['disk', 'Disk'],
  ] as const;

  for (const [key, label] of thresholdKeys) {
    bot.action(`settings:${key}`, async (tCtx) => {
      await tCtx.answerCbQuery();
      const thresholds = configManager.getThresholds();
      const current = thresholds[`${key}Percent` as keyof typeof thresholds];
      await tCtx.editMessageText(
        t(configManager, 'settings.threshold_prompt', { resource: label, value: String(current) }),
        Markup.inlineKeyboard([
          [Markup.button.callback('70%', `thresh:${key}:70`), Markup.button.callback('80%', `thresh:${key}:80`)],
          [Markup.button.callback('90%', `thresh:${key}:90`), Markup.button.callback('95%', `thresh:${key}:95`)],
          [Markup.button.callback(t(configManager, 'settings.threshold_custom'), `thresh:${key}:custom`)],
          [Markup.button.callback(t(configManager, 'settings.back'), 'settings:resources')],
        ]),
      );
    });
  }

  bot.action(/^thresh:(cpu|ram|disk):(\d+)$/, async (tCtx) => {
    await tCtx.answerCbQuery();
    const resource = tCtx.match[1] as 'cpu' | 'ram' | 'disk';
    const value = parseInt(tCtx.match[2], 10);
    const keyMap = { cpu: 'cpuPercent', ram: 'ramPercent', disk: 'diskPercent' } as const;
    configManager.updateThreshold(keyMap[resource], value);
    await tCtx.editMessageText(
      t(configManager, 'settings.threshold_set', { resource: resource.toUpperCase(), value: String(value) }),
    );
  });

  bot.action(/^thresh:(cpu|ram|disk):custom$/, async (tCtx) => {
    await tCtx.answerCbQuery();
    const resource = tCtx.match[1] as 'cpu' | 'ram' | 'disk';
    const resourceLabel = { cpu: 'CPU', ram: 'RAM', disk: 'Disk' }[resource];
    awaitingThresholdInput.set(tCtx.chat!.id, resource);
    await tCtx.editMessageText(
      t(configManager, 'settings.threshold_custom_prompt', { resource: resourceLabel }),
    );
  });

  // Resources sub-menu
  bot.action('settings:resources', async (tCtx) => {
    await tCtx.answerCbQuery();
    await tCtx.editMessageText(resourcesText(configManager), resourcesKeyboard(configManager));
  });

  bot.action('settings:toggle_alerts', async (tCtx) => {
    await tCtx.answerCbQuery();
    const current = configManager.isResourceMonitorEnabled();
    configManager.setResourceMonitorEnabled(!current);
    await tCtx.editMessageText(resourcesText(configManager), resourcesKeyboard(configManager));
  });

  // Reset — confirmation
  bot.action('settings:reset', async (tCtx) => {
    await tCtx.answerCbQuery();
    await tCtx.editMessageText(
      t(configManager, 'reset.warning'),
      Markup.inlineKeyboard([
        [Markup.button.callback(t(configManager, 'reset.confirm_btn'), 'settings:reset_confirm')],
        [Markup.button.callback(t(configManager, 'reset.cancel_btn'), 'settings:back')],
      ]),
    );
  });

  bot.action('settings:reset_confirm', async (tCtx) => {
    await tCtx.answerCbQuery();

    // Wipe database tables
    try {
      const { getDb } = await import('../db/schema.js');
      const db = getDb();
      db.exec('DELETE FROM messages');
      db.exec('DELETE FROM tasks');
      db.exec('DELETE FROM api_usage');
    } catch (err) {
      console.error('Reset: failed to clear DB tables:', err);
    }

    // Wipe config (keeps only telegram bot token)
    configManager.resetAll();

    // Clear assistant and start onboarding
    ctx.clearAssistant();
    await tCtx.editMessageText(t(configManager, 'reset.done'));
    await onboarding.sendWelcome(tCtx);
  });

  // Back to settings
  bot.action('settings:back', async (tCtx) => {
    await tCtx.answerCbQuery();
    await tCtx.editMessageText(settingsText(configManager), settingsKeyboard(configManager));
  });
}
