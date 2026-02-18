import { generatePKCE, buildAuthUrl, extractAuthCode, exchangeCodeForTokens, requestDeviceCode, pollDeviceToken, ANTHROPIC_OAUTH, OPENAI_OAUTH, } from '../../auth/oauth.js';
import { OAUTH_PROVIDERS, PROVIDER_API_KEY_HINTS } from '../providers.js';
import { sendModelSelection } from './model.js';
import { finishOnboarding } from './profile.js';
export async function handleProviderSelected(handler, ctx, provider) {
    const state = handler.state;
    console.log(`Onboarding: provider selected — ${provider}`);
    state.provider = provider;
    const saved = handler.deps.configManager.getSavedProvider(provider);
    if (saved && (saved.apiKey || saved.authToken)) {
        console.log(`Onboarding: found saved config for ${provider}, testing...`);
        state.apiKey = saved.apiKey || saved.authToken;
        state.isOAuth = !!saved.authToken;
        state.refreshToken = saved.refreshToken;
        state.tokenExpiresIn = saved.tokenExpiresAt
            ? Math.floor((new Date(saved.tokenExpiresAt).getTime() - Date.now()) / 1000)
            : undefined;
        state.baseUrl = saved.baseUrl ?? undefined;
        state.model = saved.model;
        state.step = 'testing';
        await ctx.editMessageText('Found saved credentials, testing connection...');
        await finishOnboarding(handler, ctx);
        return;
    }
    if (provider === 'openai-compatible') {
        state.step = 'base_url';
        await ctx.editMessageText('Enter the base URL of your API endpoint.\n\nExample: http://localhost:11434/v1');
    }
    else if (OAUTH_PROVIDERS.has(provider)) {
        state.step = 'auth_method';
        const providerLabel = provider === 'anthropic' ? 'Claude' : 'ChatGPT';
        const { Markup } = await import('telegraf');
        await ctx.editMessageText('How would you like to authenticate?', Markup.inlineKeyboard([
            [Markup.button.callback(`Sign in with ${providerLabel} (subscription)`, 'onboard_auth:oauth')],
            [Markup.button.callback('API Key (pay-as-you-go)', 'onboard_auth:api_key')],
            [Markup.button.callback('« Back', 'onboard_back_provider')],
        ]));
    }
    else {
        state.step = 'api_key';
        state.isOAuth = false;
        await ctx.editMessageText(PROVIDER_API_KEY_HINTS[provider] || 'Send your API key.');
    }
}
export async function handleAuthMethod(handler, ctx, method) {
    const state = handler.state;
    if (!state.provider) {
        handler.state = null;
        await ctx.editMessageText('Session expired. Please use /settings to try again.');
        return;
    }
    const provider = state.provider;
    console.log(`Onboarding: auth method — ${method} (provider: ${provider})`);
    state.step = 'api_key';
    if (method === 'api_key') {
        state.isOAuth = false;
        await ctx.editMessageText(PROVIDER_API_KEY_HINTS[provider] || 'Send your API key.');
    }
    else {
        state.isOAuth = true;
        if (provider === 'anthropic') {
            const pkce = generatePKCE();
            state.codeVerifier = pkce.codeVerifier;
            state.oauthState = pkce.state;
            const authUrl = buildAuthUrl(ANTHROPIC_OAUTH, pkce);
            await ctx.editMessageText('Sign in with your Claude account:\n\n'
                + authUrl + '\n\n'
                + 'After signing in, copy the full URL from your browser and send it here.\n\n'
                + 'Or paste a setup token (starts with sk-ant-oat01-).');
        }
        else {
            try {
                const { deviceAuthId, userCode } = await requestDeviceCode(OPENAI_OAUTH);
                state.deviceAuthId = deviceAuthId;
                state.deviceUserCode = userCode;
                state.isPolling = true;
                await ctx.editMessageText('Sign in with your ChatGPT account:\n\n'
                    + '1. Open: https://auth.openai.com/codex/device\n'
                    + `2. Enter code: \`${userCode}\`\n\n`
                    + 'Waiting for authorization...\n\nOr paste a session token if you have one.', { parse_mode: 'Markdown' });
                console.log('Onboarding: starting device code polling in background');
                pollDeviceCodeInBackground(handler, ctx);
            }
            catch (err) {
                console.error('Device code request failed:', err);
                await ctx.editMessageText('Could not start device authorization. Please paste your API key or session token directly.');
            }
        }
    }
}
export async function handleApiKeyInput(handler, ctx, input) {
    const state = handler.state;
    if (state.isOAuth && state.provider === 'anthropic') {
        if (input.startsWith('sk-ant-oat01-')) {
            state.apiKey = input;
        }
        else {
            try {
                const code = extractAuthCode(input);
                const tokens = await exchangeCodeForTokens(ANTHROPIC_OAUTH, code, state.codeVerifier, state.oauthState);
                state.apiKey = tokens.accessToken;
                state.refreshToken = tokens.refreshToken;
                state.tokenExpiresIn = tokens.expiresIn;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await ctx.reply('Failed to exchange authorization code: ' + msg + '\n\n'
                    + 'Please try again — paste the full URL from your browser, or a setup token.');
                return;
            }
        }
    }
    else if (state.isOAuth && state.provider === 'openai') {
        if (state.isPolling) {
            if (input.startsWith('sk-') || input.length > 40) {
                console.log('Onboarding: user pasted token directly, stopping background polling');
                state.isPolling = false;
                state.apiKey = input;
            }
            else {
                await ctx.reply('Waiting for authorization... You can also paste a session token directly.');
                return;
            }
        }
        else {
            state.apiKey = input;
        }
    }
    else {
        state.apiKey = input === '-' ? undefined : input;
    }
    state.step = 'model';
    await sendModelSelection(handler, ctx);
}
function pollDeviceCodeInBackground(handler, ctx) {
    const state = handler.state;
    const deviceAuthId = state.deviceAuthId;
    const userCode = state.deviceUserCode;
    pollDeviceToken(OPENAI_OAUTH, deviceAuthId, userCode, 60, 5000, (attempt, max, status) => {
        if (attempt % 6 === 0) {
            const remaining = Math.ceil((max - attempt) * 5 / 60);
            console.log(`Onboarding: device polling attempt ${attempt}/${max} — ${status}, ~${remaining} min left`);
        }
    }).then(async (tokens) => {
        // Always read current state from handler (not captured reference)
        const current = handler.state;
        if (!current?.isPolling) {
            console.log('Onboarding: device polling completed but was cancelled — ignoring');
            return;
        }
        current.isPolling = false;
        current.apiKey = tokens.accessToken;
        current.refreshToken = tokens.refreshToken;
        current.tokenExpiresIn = tokens.expiresIn;
        console.log('Onboarding: device authorization successful');
        await ctx.reply('Authorization successful!');
        current.step = 'model';
        await sendModelSelection(handler, ctx);
    }).catch(async (err) => {
        const current = handler.state;
        if (!current?.isPolling)
            return;
        current.isPolling = false;
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Onboarding: device polling failed —', msg);
        await ctx.reply('Device authorization failed: ' + msg + '\n\nPlease try again or paste a session token directly.');
    });
}
//# sourceMappingURL=auth.js.map