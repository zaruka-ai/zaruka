import { Markup } from 'telegraf';
import { providerKeyboard } from '../providers.js';
import { clearModelsCache } from '../models.js';
import { languageKeyboardRows } from '../utils.js';
import { handleProviderSelected, handleAuthMethod, handleApiKeyInput } from './auth.js';
import { handleShowAllModels } from './model.js';
import { finishOnboarding } from './profile.js';
export class OnboardingHandler {
    state = null;
    deps;
    constructor(deps, initial) {
        this.deps = deps;
        if (initial) {
            this.state = { step: 'ask_language' };
        }
    }
    get active() { return this.state !== null; }
    reset() { this.state = null; }
    async sendWelcome(ctx) {
        console.log('Onboarding: starting with language selection');
        this.state = { step: 'ask_language' };
        await ctx.reply('Welcome to Zaruka! 👋\n\n🌐 Choose your language:', Markup.inlineKeyboard(languageKeyboardRows('onboard_lang:')));
    }
    async handleLanguageSelected(ctx, language) {
        if (!this.state)
            return;
        console.log(`Onboarding: language selected — ${language}`);
        this.deps.configManager.updateLanguage(language);
        this.state.step = 'provider';
        await ctx.editMessageText(`✓ ${language}\n\nChoose your AI provider:`, providerKeyboard());
    }
    async startProviderChange(ctx) {
        console.log('Settings: user requested provider change');
        this.state = { step: 'provider' };
        clearModelsCache();
        await ctx.editMessageText('Choose a new AI provider:', providerKeyboard());
    }
    async handleProviderSelected(ctx, provider) {
        if (!this.state)
            return;
        await handleProviderSelected(this, ctx, provider);
    }
    async handleAuthMethod(ctx, method) {
        if (!this.state)
            return;
        await handleAuthMethod(this, ctx, method);
    }
    async handleModelSelected(ctx, model) {
        if (!this.state)
            return;
        console.log(`Onboarding: model selected — ${model}`);
        this.state.model = model;
        this.state.step = 'testing';
        await ctx.editMessageText('Testing connection...');
        await finishOnboarding(this, ctx);
    }
    async handleShowAllModels(ctx) {
        if (!this.state)
            return;
        await handleShowAllModels(this, ctx);
    }
    async handleBackToProvider(ctx) {
        this.state = { step: 'provider' };
        clearModelsCache();
        await ctx.editMessageText('Choose your AI provider:', providerKeyboard());
    }
    async handleRetry(ctx) { await this.sendWelcome(ctx); }
    async handleText(ctx, text) {
        if (!this.state)
            return;
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
//# sourceMappingURL=handler.js.map