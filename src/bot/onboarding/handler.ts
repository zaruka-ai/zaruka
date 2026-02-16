import { Markup } from 'telegraf';
import type { ConfigManager } from '../../core/config-manager.js';
import type { AiProvider } from '../../core/types.js';
import { providerKeyboard } from '../providers.js';
import { clearModelsCache } from '../models.js';
import { languageKeyboardRows } from '../utils.js';
import { handleProviderSelected, handleAuthMethod, handleApiKeyInput } from './auth.js';
import { handleShowAllModels } from './model.js';
import { finishOnboarding } from './profile.js';

export type OnboardingStep = 'ask_language' | 'provider' | 'auth_method' | 'api_key' | 'base_url' | 'model' | 'testing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ctx = any;

export interface OnboardingState {
  step: OnboardingStep;
  provider?: AiProvider;
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
  /** Skip profile questions — set when changing providers from settings. */
  skipProfile?: boolean;
}

export interface OnboardingDeps {
  configManager: ConfigManager;
  onSetupComplete?: () => Promise<void>;
  /** Called after first-time onboarding completes — triggers the AI greeting. */
  onOnboardingComplete?: (ctx: Ctx) => Promise<void>;
}

export class OnboardingHandler {
  state: OnboardingState | null = null;
  deps: OnboardingDeps;

  constructor(deps: OnboardingDeps, initial?: boolean) {
    this.deps = deps;
    if (initial) {
      this.state = { step: 'ask_language' };
    }
  }

  get active(): boolean { return this.state !== null; }
  reset(): void { this.state = null; }

  async sendWelcome(ctx: Ctx): Promise<void> {
    console.log('Onboarding: starting with language selection');
    this.state = { step: 'ask_language' };
    await ctx.reply(
      'Welcome to Zaruka! 👋\n\n🌐 Choose your language:',
      Markup.inlineKeyboard(languageKeyboardRows('onboard_lang:')),
    );
  }

  async handleLanguageSelected(ctx: Ctx, language: string): Promise<void> {
    if (!this.state) return;
    console.log(`Onboarding: language selected — ${language}`);
    this.deps.configManager.updateLanguage(language);
    this.state.step = 'provider';
    await ctx.editMessageText(`✓ ${language}\n\nChoose your AI provider:`, providerKeyboard());
  }

  async startProviderChange(ctx: Ctx): Promise<void> {
    console.log('Settings: user requested provider change');
    this.state = { step: 'provider' };
    clearModelsCache();
    await ctx.editMessageText('Choose a new AI provider:', providerKeyboard());
  }

  async handleProviderSelected(ctx: Ctx, provider: AiProvider): Promise<void> {
    if (!this.state) return;
    await handleProviderSelected(this, ctx, provider);
  }

  async handleAuthMethod(ctx: Ctx, method: 'api_key' | 'oauth'): Promise<void> {
    if (!this.state) return;
    await handleAuthMethod(this, ctx, method);
  }

  async handleModelSelected(ctx: Ctx, model: string): Promise<void> {
    if (!this.state) return;
    console.log(`Onboarding: model selected — ${model}`);
    this.state.model = model;
    this.state.step = 'testing';
    await ctx.editMessageText('Testing connection...');
    await finishOnboarding(this, ctx);
  }

  async handleShowAllModels(ctx: Ctx): Promise<void> {
    if (!this.state) return;
    await handleShowAllModels(this, ctx);
  }

  async handleBackToProvider(ctx: Ctx): Promise<void> {
    this.state = { step: 'provider' };
    clearModelsCache();
    await ctx.editMessageText('Choose your AI provider:', providerKeyboard());
  }

  async handleRetry(ctx: Ctx): Promise<void> { await this.sendWelcome(ctx); }

  async handleText(ctx: Ctx, text: string): Promise<void> {
    if (!this.state) return;
    const state = this.state;

    if (state.isPolling) {
      await ctx.reply('Please wait, checking authorization...');
      return;
    }

    switch (state.step) {
      case 'ask_language':
        await this.sendWelcome(ctx);
        break;
      case 'provider':
        await ctx.reply('Please choose a provider using the buttons above.');
        break;
      case 'auth_method':
        await ctx.reply('Please choose an authentication method using the buttons above.');
        break;
      case 'base_url':
        state.baseUrl = text.trim();
        state.step = 'api_key';
        await ctx.reply('Send your API key, or send `-` to skip (if your endpoint has no auth).');
        break;
      case 'api_key':
        await handleApiKeyInput(this, ctx, text.trim());
        break;
      case 'model':
        state.model = text.trim();
        state.step = 'testing';
        await ctx.reply('Testing connection...');
        await finishOnboarding(this, ctx);
        break;
      default:
        break;
    }
  }
}
