import { Markup } from 'telegraf';
import { fetchAvailableModels, clearModelsCache } from '../models.js';
function buildModelButtons(models, prefix) {
    return models.map((m) => [Markup.button.callback(m.label.length > 50 ? m.label.slice(0, 47) + '...' : m.label, `${prefix}${m.id}`)]);
}
function buildTempAiConfig(handler) {
    const state = handler.state;
    return {
        provider: state.provider,
        apiKey: state.isOAuth ? undefined : state.apiKey,
        authToken: state.isOAuth ? state.apiKey : undefined,
        model: '',
        baseUrl: state.baseUrl ?? null,
    };
}
export async function sendModelSelection(handler, ctx) {
    const state = handler.state;
    if (state.provider === 'openai-compatible') {
        await ctx.reply('Enter your model name (e.g. `llama3`, `mistral`, `qwen2`):');
        return;
    }
    clearModelsCache();
    await ctx.reply('Loading available models...');
    const { popular, all } = await fetchAvailableModels(buildTempAiConfig(handler));
    if (popular.length > 0) {
        const buttons = buildModelButtons(popular, 'onboard_model:');
        if (all.length > popular.length) {
            buttons.push([Markup.button.callback('Show all models...', 'onboard_models_all')]);
        }
        buttons.push([Markup.button.callback('« Back', 'onboard_back_provider')]);
        await ctx.reply('Choose a model:', Markup.inlineKeyboard(buttons));
    }
    else if (all.length > 0) {
        const buttons = buildModelButtons(all, 'onboard_model:');
        buttons.push([Markup.button.callback('« Back', 'onboard_back_provider')]);
        await ctx.reply('Choose a model:', Markup.inlineKeyboard(buttons));
    }
    else {
        await ctx.reply('Could not fetch models. Enter model name manually:');
    }
}
export async function handleShowAllModels(handler, ctx) {
    const { all } = await fetchAvailableModels(buildTempAiConfig(handler));
    if (all.length > 0) {
        const buttons = buildModelButtons(all, 'onboard_model:');
        buttons.push([Markup.button.callback('« Back', 'onboard_back_provider')]);
        await ctx.editMessageText('Choose a model:', Markup.inlineKeyboard(buttons));
    }
    else {
        await ctx.editMessageText('Could not fetch models. Enter model name manually:');
    }
}
//# sourceMappingURL=model.js.map