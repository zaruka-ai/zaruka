import { Markup } from 'telegraf';
import type { ZarukaConfig } from '../../core/types.js';
import { fetchAvailableModels, clearModelsCache } from '../models.js';
import { testAiConnection, PROVIDER_LABELS } from '../providers.js';
import { finishOnboarding } from './profile.js';
import type { OnboardingHandler, Ctx } from './handler.js';

function buildModelButtons(models: { id: string; label: string }[], prefix: string) {
  return models.map((m) => [Markup.button.callback(
    m.label.length > 50 ? m.label.slice(0, 47) + '...' : m.label,
    `${prefix}${m.id}`,
  )]);
}

function buildTempAiConfig(handler: OnboardingHandler): NonNullable<ZarukaConfig['ai']> {
  const state = handler.state!;
  return {
    provider: state.provider!,
    apiKey: state.isOAuth ? undefined : state.apiKey,
    authToken: state.isOAuth ? state.apiKey : undefined,
    model: '',
    baseUrl: state.baseUrl ?? null,
  };
}

export async function sendModelSelection(handler: OnboardingHandler, ctx: Ctx): Promise<void> {
  clearModelsCache();
  await ctx.reply('Loading available models...');

  const { popular, all } = await fetchAvailableModels(buildTempAiConfig(handler));

  if (popular.length > 0) {
    const buttons = buildModelButtons(popular, 'onboard_model:');
    if (all.length > popular.length) {
      buttons.push([Markup.button.callback('Show all models...', 'onboard_models_all')]);
    }
    buttons.push([Markup.button.callback('\u00ab Back', 'onboard_back_provider')]);
    await ctx.reply('Choose a model:', Markup.inlineKeyboard(buttons));
  } else if (all.length > 0) {
    const buttons = buildModelButtons(all, 'onboard_model:');
    buttons.push([Markup.button.callback('\u00ab Back', 'onboard_back_provider')]);
    await ctx.reply('Choose a model:', Markup.inlineKeyboard(buttons));
  } else {
    // Model fetch failed — try fallback to saved providers
    await tryFallbackProviders(handler, ctx);
  }
}

/** When model fetch fails, try saved providers and auto-switch to the first working one. */
async function tryFallbackProviders(handler: OnboardingHandler, ctx: Ctx): Promise<void> {
  const { configManager } = handler.deps;
  const state = handler.state!;
  const failedProvider = state.provider;

  const savedProviders = configManager.getConfig().savedProviders ?? {};
  const candidates = Object.values(savedProviders)
    .filter((sp) => sp.provider !== failedProvider && (sp.apiKey || sp.authToken));

  for (const saved of candidates) {
    console.log(`Onboarding fallback: testing ${saved.provider}/${saved.model}...`);
    const result = await testAiConnection(saved);
    if (result.ok) {
      console.log(`Onboarding fallback: ${saved.provider} works, auto-switching`);
      // Update onboarding state to this provider's config
      state.provider = saved.provider;
      state.apiKey = saved.apiKey || saved.authToken;
      state.isOAuth = !!saved.authToken;
      state.refreshToken = saved.refreshToken;
      state.tokenExpiresIn = saved.tokenExpiresAt
        ? Math.floor((new Date(saved.tokenExpiresAt).getTime() - Date.now()) / 1000)
        : undefined;
      state.baseUrl = saved.baseUrl ?? undefined;
      state.model = saved.model;
      state.step = 'testing';

      const failedLabel = PROVIDER_LABELS[failedProvider!] ?? failedProvider;
      const newLabel = PROVIDER_LABELS[saved.provider];
      await ctx.reply(`\u26a0\ufe0f Could not reach ${failedLabel}. Switching to ${newLabel} (${saved.model}).`);
      await finishOnboarding(handler, ctx);
      return;
    }
  }

  // All saved providers failed or none exist
  if (candidates.length > 0) {
    const buttons = candidates.map((sp) => [
      Markup.button.callback(
        `${PROVIDER_LABELS[sp.provider]} (${sp.model})`,
        `onboard_switch:${sp.provider}`,
      ),
    ]);
    buttons.push([Markup.button.callback('\u00ab Back', 'onboard_back_provider')]);
    await ctx.reply(
      'Could not connect to any saved provider automatically.\n\nChoose a provider to try:',
      Markup.inlineKeyboard(buttons),
    );
  } else {
    await ctx.reply(
      'Could not fetch models. Please check your credentials and try again.',
      Markup.inlineKeyboard([[Markup.button.callback('\u00ab Back', 'onboard_back_provider')]]),
    );
  }
}

export async function handleShowAllModels(handler: OnboardingHandler, ctx: Ctx): Promise<void> {
  const { all } = await fetchAvailableModels(buildTempAiConfig(handler));

  if (all.length > 0) {
    const buttons = buildModelButtons(all, 'onboard_model:');
    buttons.push([Markup.button.callback('\u00ab Back', 'onboard_back_provider')]);
    await ctx.editMessageText('Choose a model:', Markup.inlineKeyboard(buttons));
  } else {
    await ctx.editMessageText(
      'Could not fetch models. Please check your credentials and try again.',
      Markup.inlineKeyboard([[Markup.button.callback('\u00ab Back', 'onboard_back_provider')]]),
    );
  }
}
