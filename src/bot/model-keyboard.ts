import { Markup } from 'telegraf';
import type { AiProviderConfig } from '../core/types.js';
import type { ConfigManager } from '../core/config-manager.js';
import { fetchAvailableModels, clearModelsCache } from './models.js';
import { PROVIDER_LABELS } from './providers.js';
import { t } from './i18n.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any;

/**
 * Fetch models for a provider and display them as an inline keyboard.
 * Returns false if no models were found.
 */
export async function showModelList(
  ctx: Ctx,
  ai: AiProviderConfig,
  configManager: ConfigManager,
  opts: { modelPrefix: string; showAllAction: string; backAction: string },
): Promise<boolean> {
  clearModelsCache();
  const { popular, all } = await fetchAvailableModels(ai);
  const models = popular.length > 0 ? popular : all;

  if (models.length === 0) return false;

  const currentModel = configManager.getModel();
  const currentProvider = configManager.getConfig().ai?.provider;

  const modelButtons = models.map((m) => {
    const check = m.id === currentModel && ai.provider === currentProvider ? ' \u2713' : '';
    const label = m.label.length > 50 ? m.label.slice(0, 47) + '...' : m.label;
    return [Markup.button.callback(`${label}${check}`, `${opts.modelPrefix}${m.id}`)];
  });

  if (popular.length > 0 && all.length > popular.length) {
    modelButtons.push([Markup.button.callback(
      t(configManager, 'settings.show_all') || 'Show all models...',
      opts.showAllAction,
    )]);
  }

  modelButtons.push([Markup.button.callback('\u00ab Back', opts.backAction)]);

  await ctx.editMessageText(
    `${PROVIDER_LABELS[ai.provider]}\n\n${t(configManager, 'settings.choose_model') || 'Choose a model:'}`,
    Markup.inlineKeyboard(modelButtons),
  );

  return true;
}
