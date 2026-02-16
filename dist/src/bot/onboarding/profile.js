import { Markup } from 'telegraf';
import { testAiConnection } from '../providers.js';
export async function finishOnboarding(handler, ctx) {
    const state = handler.state;
    if (!state || !state.provider || !state.model)
        return;
    const tokenExpiresAt = state.tokenExpiresIn
        ? new Date(Date.now() + state.tokenExpiresIn * 1000).toISOString()
        : undefined;
    const aiConfig = {
        provider: state.provider,
        apiKey: state.isOAuth ? undefined : state.apiKey,
        authToken: state.isOAuth ? state.apiKey : undefined,
        refreshToken: state.isOAuth ? state.refreshToken : undefined,
        tokenExpiresAt: state.isOAuth ? tokenExpiresAt : undefined,
        model: state.model,
        baseUrl: state.baseUrl ?? null,
    };
    console.log(`Onboarding: testing AI connection (${state.provider}, ${state.model})...`);
    const result = await testAiConnection(aiConfig);
    if (!result.ok) {
        console.log(`Onboarding: connection failed — ${result.error}`);
        handler.state = { step: 'provider' };
        await ctx.reply('Connection failed: ' + (result.error || 'Unknown error') + '\n\nPlease try again.', Markup.inlineKeyboard([[Markup.button.callback('Retry setup', 'onboard:retry')]]));
        return;
    }
    console.log('Onboarding: connection successful');
    handler.deps.configManager.updateAiConfig(aiConfig);
    // Settings flow: just switch provider and rebuild — no profile questions, no "setup complete"
    if (state.skipProfile) {
        console.log('Settings: provider switch successful');
        handler.state = null;
        if (handler.deps.onSetupComplete) {
            await handler.deps.onSetupComplete();
        }
        await ctx.reply(`✓ Switched to ${state.provider}, model: ${state.model}`);
        return;
    }
    await completeOnboarding(handler, ctx);
}
export async function completeOnboarding(handler, ctx) {
    const state = handler.state;
    if (!state)
        return;
    if (handler.deps.onSetupComplete) {
        try {
            await handler.deps.onSetupComplete();
        }
        catch (err) {
            console.error('Failed to initialize assistant after onboarding:', err);
            await ctx.reply('Setup saved but failed to initialize. Please restart the bot.');
            return;
        }
    }
    handler.state = null;
    // Trigger AI greeting — the system prompt instructs it to ask for profile data
    if (handler.deps.onOnboardingComplete) {
        await handler.deps.onOnboardingComplete(ctx);
    }
}
//# sourceMappingURL=profile.js.map