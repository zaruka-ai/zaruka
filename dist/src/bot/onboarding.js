import { Markup } from 'telegraf';
import { generatePKCE, buildAuthUrl, extractAuthCode, exchangeCodeForTokens, requestDeviceCode, pollDeviceToken, ANTHROPIC_OAUTH, OPENAI_OAUTH, } from '../auth/oauth.js';
import { providerKeyboard, OAUTH_PROVIDERS, PROVIDER_API_KEY_HINTS, testAiConnection } from './providers.js';
import { fetchAvailableModels, clearModelsCache } from './models.js';
import { parseBirthday, resolveTimezone, resolveTimezoneFromCoords } from './utils.js';
/**
 * Manages the entire onboarding flow: provider selection, auth, model picking, profile.
 */
export class OnboardingHandler {
    state = null;
    deps;
    constructor(deps, initial) {
        this.deps = deps;
        if (initial) {
            this.state = { step: 'provider' };
        }
    }
    get active() {
        return this.state !== null;
    }
    reset() {
        this.state = null;
    }
    // === Entry points ===
    async sendWelcome(ctx) {
        console.log('Onboarding: starting provider selection');
        this.state = { step: 'provider' };
        await ctx.reply('Welcome to Zaruka! Let\'s set up your AI provider.\n\n'
            + 'Choose your AI provider:', providerKeyboard());
    }
    async startProviderChange(ctx) {
        console.log('Settings: user requested provider change');
        this.state = { step: 'provider' };
        clearModelsCache();
        await ctx.editMessageText('Choose a new AI provider:', providerKeyboard());
    }
    // === Callback handlers (call from bot.action) ===
    async handleProviderSelected(ctx, provider) {
        if (!this.state)
            return;
        console.log(`Onboarding: provider selected — ${provider}`);
        this.state.provider = provider;
        // Check saved config
        const saved = this.deps.configManager.getSavedProvider(provider);
        if (saved && (saved.apiKey || saved.authToken)) {
            console.log(`Onboarding: found saved config for ${provider}, testing...`);
            this.state.apiKey = saved.apiKey || saved.authToken;
            this.state.isOAuth = !!saved.authToken;
            this.state.refreshToken = saved.refreshToken;
            this.state.tokenExpiresIn = saved.tokenExpiresAt
                ? Math.floor((new Date(saved.tokenExpiresAt).getTime() - Date.now()) / 1000)
                : undefined;
            this.state.baseUrl = saved.baseUrl ?? undefined;
            this.state.model = saved.model;
            this.state.step = 'testing';
            await ctx.editMessageText('Found saved credentials, testing connection...');
            await this.finishOnboarding(ctx);
            return;
        }
        if (provider === 'openai-compatible') {
            this.state.step = 'base_url';
            await ctx.editMessageText('Enter the base URL of your API endpoint.\n\n'
                + 'Example: http://localhost:11434/v1');
        }
        else if (OAUTH_PROVIDERS.has(provider)) {
            this.state.step = 'auth_method';
            const providerLabel = provider === 'anthropic' ? 'Claude' : 'ChatGPT';
            await ctx.editMessageText('How would you like to authenticate?', Markup.inlineKeyboard([
                [Markup.button.callback('API Key (pay-as-you-go)', 'onboard_auth:api_key')],
                [Markup.button.callback(`Sign in with ${providerLabel} (subscription)`, 'onboard_auth:oauth')],
            ]));
        }
        else {
            this.state.step = 'api_key';
            this.state.isOAuth = false;
            await ctx.editMessageText(PROVIDER_API_KEY_HINTS[provider] || 'Send your API key.');
        }
    }
    async handleAuthMethod(ctx, method) {
        if (!this.state)
            return;
        const provider = this.state.provider;
        console.log(`Onboarding: auth method — ${method} (provider: ${provider})`);
        this.state.step = 'api_key';
        if (method === 'api_key') {
            this.state.isOAuth = false;
            await ctx.editMessageText(PROVIDER_API_KEY_HINTS[provider] || 'Send your API key.');
        }
        else {
            this.state.isOAuth = true;
            if (provider === 'anthropic') {
                const pkce = generatePKCE();
                this.state.codeVerifier = pkce.codeVerifier;
                this.state.oauthState = pkce.state;
                const authUrl = buildAuthUrl(ANTHROPIC_OAUTH, pkce);
                await ctx.editMessageText('Sign in with your Claude account:\n\n'
                    + authUrl + '\n\n'
                    + 'After signing in, copy the full URL from your browser and send it here.\n\n'
                    + 'Or paste a setup token (starts with sk-ant-oat01-).');
            }
            else {
                try {
                    const { deviceAuthId, userCode } = await requestDeviceCode(OPENAI_OAUTH);
                    this.state.deviceAuthId = deviceAuthId;
                    this.state.deviceUserCode = userCode;
                    this.state.isPolling = true;
                    await ctx.editMessageText('Sign in with your ChatGPT account:\n\n'
                        + '1. Open: https://auth.openai.com/codex/device\n'
                        + `2. Enter code: ${userCode}\n\n`
                        + 'Waiting for authorization...\n\n'
                        + 'Or paste a session token if you have one.');
                    console.log('Onboarding: starting device code polling in background');
                    this.pollDeviceCodeInBackground(ctx, this.state);
                }
                catch (err) {
                    console.error('Device code request failed:', err);
                    await ctx.editMessageText('Could not start device authorization. Please paste your API key or session token directly.');
                }
            }
        }
    }
    async handleModelSelected(ctx, model) {
        if (!this.state)
            return;
        console.log(`Onboarding: model selected — ${model}`);
        this.state.model = model;
        this.state.step = 'testing';
        await ctx.editMessageText('Testing connection...');
        await this.finishOnboarding(ctx);
    }
    async handleNameConfirm(ctx) {
        if (!this.state || this.state.step !== 'ask_name')
            return;
        this.state.profileName = this.state.telegramFirstName || '';
        this.state.step = 'ask_city';
        await this.sendAskCity(ctx);
    }
    async handleNameChange(ctx) {
        if (!this.state || this.state.step !== 'ask_name')
            return;
        await ctx.editMessageText('What should I call you?');
    }
    async handleCitySkip(ctx) {
        if (!this.state)
            return;
        this.state.step = 'ask_birthday';
        await this.sendAskBirthday(ctx);
    }
    async handleCityType(ctx) {
        if (!this.state)
            return;
        await ctx.reply('Type your city name:', Markup.removeKeyboard());
    }
    async handleBirthdaySkip(ctx) {
        if (!this.state)
            return;
        await this.completeOnboarding(ctx);
    }
    async handleRetry(ctx) {
        await this.sendWelcome(ctx);
    }
    // === Location handler ===
    async handleLocation(ctx, lat, lon) {
        if (!this.state || this.state.step !== 'ask_city')
            return;
        await ctx.reply('Resolving your location...', Markup.removeKeyboard());
        const result = await resolveTimezoneFromCoords(lat, lon);
        if (result) {
            this.state.profileCity = result.city;
            this.state.profileTimezone = result.timezone;
            await ctx.reply(`Got it, ${result.city} (${result.timezone})!`);
        }
        else {
            await ctx.reply('Could not determine timezone from location, skipping.');
        }
        this.state.step = 'ask_birthday';
        await this.sendAskBirthday(ctx);
    }
    // === Text input handler ===
    async handleText(ctx, text) {
        if (!this.state)
            return;
        const state = this.state;
        if (state.isPolling) {
            await ctx.reply('Please wait, checking authorization...');
            return;
        }
        switch (state.step) {
            case 'provider':
                await this.sendWelcome(ctx);
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
                await this.handleApiKeyInput(ctx, text.trim());
                break;
            case 'model':
                state.model = text.trim();
                state.step = 'testing';
                await ctx.reply('Testing connection...');
                await this.finishOnboarding(ctx);
                break;
            case 'ask_name':
                state.profileName = text.trim();
                state.step = 'ask_city';
                await this.sendAskCity(ctx);
                break;
            case 'ask_city': {
                const cityResult = await resolveTimezone(text.trim());
                if (cityResult) {
                    state.profileCity = cityResult.city;
                    state.profileTimezone = cityResult.timezone;
                    await ctx.reply(`Got it, ${cityResult.city} (${cityResult.timezone})!`, Markup.removeKeyboard());
                }
                else {
                    state.profileCity = text.trim();
                    await ctx.reply(`Saved "${text.trim()}" as your city.`, Markup.removeKeyboard());
                }
                state.step = 'ask_birthday';
                await this.sendAskBirthday(ctx);
                break;
            }
            case 'ask_birthday': {
                const birthday = parseBirthday(text);
                if (birthday) {
                    state.profileBirthday = birthday;
                    const [mm, dd] = birthday.split('-');
                    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                    await ctx.reply(`Got it, ${monthNames[parseInt(mm, 10) - 1]} ${parseInt(dd, 10)}!`);
                }
                else {
                    await ctx.reply('Could not parse the date. Skipping birthday.');
                }
                await this.completeOnboarding(ctx);
                break;
            }
            default:
                break;
        }
    }
    // === Private helpers ===
    async handleApiKeyInput(ctx, input) {
        const state = this.state;
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
        await this.sendModelSelection(ctx);
    }
    buildModelButtons(models, prefix) {
        return models.map((m) => [Markup.button.callback(m.label.length > 50 ? m.label.slice(0, 47) + '...' : m.label, `${prefix}${m.id}`)]);
    }
    async sendModelSelection(ctx) {
        const state = this.state;
        if (state.provider === 'openai-compatible') {
            await ctx.reply('Enter your model name (e.g. `llama3`, `mistral`, `qwen2`):');
            return;
        }
        const tempAi = {
            provider: state.provider,
            apiKey: state.isOAuth ? undefined : state.apiKey,
            authToken: state.isOAuth ? state.apiKey : undefined,
            model: '',
            baseUrl: state.baseUrl ?? null,
        };
        clearModelsCache();
        await ctx.reply('Loading available models...');
        const { popular, all } = await fetchAvailableModels(tempAi);
        if (popular.length > 0) {
            const buttons = this.buildModelButtons(popular, 'onboard_model:');
            if (all.length > popular.length) {
                buttons.push([Markup.button.callback('Show all models...', 'onboard_models_all')]);
            }
            buttons.push([Markup.button.callback('« Back', 'onboard_back_provider')]);
            await ctx.reply('Choose a model:', Markup.inlineKeyboard(buttons));
        }
        else if (all.length > 0) {
            const buttons = this.buildModelButtons(all, 'onboard_model:');
            buttons.push([Markup.button.callback('« Back', 'onboard_back_provider')]);
            await ctx.reply('Choose a model:', Markup.inlineKeyboard(buttons));
        }
        else {
            await ctx.reply('Could not fetch models. Enter model name manually:');
        }
    }
    async handleShowAllModels(ctx) {
        if (!this.state)
            return;
        const tempAi = {
            provider: this.state.provider,
            apiKey: this.state.isOAuth ? undefined : this.state.apiKey,
            authToken: this.state.isOAuth ? this.state.apiKey : undefined,
            model: '',
            baseUrl: this.state.baseUrl ?? null,
        };
        const { all } = await fetchAvailableModels(tempAi);
        if (all.length > 0) {
            const buttons = this.buildModelButtons(all, 'onboard_model:');
            buttons.push([Markup.button.callback('« Back', 'onboard_back_provider')]);
            await ctx.editMessageText('Choose a model:', Markup.inlineKeyboard(buttons));
        }
        else {
            await ctx.editMessageText('Could not fetch models. Enter model name manually:');
        }
    }
    async handleBackToProvider(ctx) {
        this.state = { step: 'provider' };
        clearModelsCache();
        await ctx.editMessageText('Choose your AI provider:', providerKeyboard());
    }
    pollDeviceCodeInBackground(ctx, state) {
        const deviceAuthId = state.deviceAuthId;
        const userCode = state.deviceUserCode;
        pollDeviceToken(OPENAI_OAUTH, deviceAuthId, userCode, 60, 5000, (attempt, max, status) => {
            if (attempt % 6 === 0) {
                const remaining = Math.ceil((max - attempt) * 5 / 60);
                console.log(`Onboarding: device polling attempt ${attempt}/${max} — ${status}, ~${remaining} min left`);
            }
        }).then(async (tokens) => {
            if (!state.isPolling) {
                console.log('Onboarding: device polling completed but was cancelled — ignoring');
                return;
            }
            state.isPolling = false;
            state.apiKey = tokens.accessToken;
            state.refreshToken = tokens.refreshToken;
            state.tokenExpiresIn = tokens.expiresIn;
            console.log('Onboarding: device authorization successful');
            await ctx.reply('Authorization successful!');
            state.step = 'model';
            await this.sendModelSelection(ctx);
        }).catch(async (err) => {
            if (!state.isPolling)
                return;
            state.isPolling = false;
            const msg = err instanceof Error ? err.message : String(err);
            console.error('Onboarding: device polling failed —', msg);
            await ctx.reply('Device authorization failed: ' + msg + '\n\n'
                + 'Please try again or paste a session token directly.');
        });
    }
    async finishOnboarding(ctx) {
        const state = this.state;
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
            this.state = { step: 'provider' };
            await ctx.reply('Connection failed: ' + (result.error || 'Unknown error') + '\n\n'
                + 'Please try again.', Markup.inlineKeyboard([
                [Markup.button.callback('Retry setup', 'onboard:retry')],
            ]));
            return;
        }
        console.log('Onboarding: connection successful');
        this.deps.configManager.updateAiConfig(aiConfig);
        const firstName = ctx.from?.first_name || '';
        this.state = {
            ...state,
            step: 'ask_name',
            telegramFirstName: firstName,
        };
        await ctx.reply(`Connection successful! Can I call you *${firstName}*?`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('Yes', 'onboard_name:confirm')],
                [Markup.button.callback('Call me differently', 'onboard_name:change')],
            ]),
        });
    }
    async sendAskCity(ctx) {
        const name = this.state?.profileName || '';
        await ctx.reply(`${name}, share your location so I can sync with your timezone — my time references and reminders will match your local time.`, Markup.keyboard([
            [Markup.button.locationRequest('📍 Share location')],
        ]).oneTime().resize());
        await ctx.reply('Or choose:', Markup.inlineKeyboard([
            [Markup.button.callback('Type city name', 'onboard_city:type')],
            [Markup.button.callback('Skip', 'onboard_skip:city')],
        ]));
    }
    async sendAskBirthday(ctx) {
        await ctx.reply('When is your birthday? I\'ll remember and make sure to congratulate you! (e.g. 15 March, 15.03)', Markup.inlineKeyboard([
            [Markup.button.callback('Skip', 'onboard_skip:birthday')],
        ]));
    }
    async completeOnboarding(ctx) {
        const state = this.state;
        if (!state)
            return;
        const profile = {};
        if (state.profileName)
            profile.name = state.profileName;
        if (state.profileCity)
            profile.city = state.profileCity;
        if (state.profileBirthday)
            profile.birthday = state.profileBirthday;
        if (state.profileTimezone) {
            profile.timezone = state.profileTimezone;
            this.deps.configManager.updateTimezone(state.profileTimezone);
        }
        if (Object.keys(profile).length > 0) {
            this.deps.configManager.updateProfile(profile);
        }
        const langCode = ctx.from?.language_code;
        if (langCode && this.deps.configManager.getLanguage() === 'auto') {
            const langMap = {
                ru: 'Russian', en: 'English', es: 'Spanish', fr: 'French',
                de: 'German', zh: 'Chinese', ja: 'Japanese', ar: 'Arabic',
            };
            const detected = langMap[langCode];
            if (detected) {
                this.deps.configManager.updateLanguage(detected);
            }
        }
        if (this.deps.onSetupComplete) {
            try {
                await this.deps.onSetupComplete();
            }
            catch (err) {
                console.error('Failed to initialize assistant after onboarding:', err);
                await ctx.reply('Setup saved but failed to initialize. Please restart the bot.');
                return;
            }
        }
        const name = state.profileName || state.telegramFirstName || '';
        const greeting = name ? `${name}, setup` : 'Setup';
        await ctx.reply(`${greeting} complete! Send me any message and I'll help you.`);
        this.state = null;
    }
}
//# sourceMappingURL=onboarding.js.map