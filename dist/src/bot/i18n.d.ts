import { type LanguageModel } from 'ai';
import type { ConfigManager } from '../core/config-manager.js';
/**
 * All translatable UI strings with English defaults.
 * Keys use dot notation: section.name
 * Values support {placeholder} interpolation.
 */
export declare const UI_STRINGS: {
    readonly 'settings.title': "⚙️ Settings";
    readonly 'settings.model_label': "Model";
    readonly 'settings.language_label': "Language";
    readonly 'settings.alerts_label': "Resource alerts";
    readonly 'settings.on': "On";
    readonly 'settings.off': "Off";
    readonly 'settings.model_btn': "🧠 Model";
    readonly 'settings.lang_btn': "🌐 Language";
    readonly 'settings.resources_btn': "📈 Resources";
    readonly 'settings.reset_btn': "🗑 Reset all data";
    readonly 'settings.back': "« Back";
    readonly 'settings.choose_provider': "Choose a provider:";
    readonly 'settings.choose_model': "Choose a model:";
    readonly 'settings.show_all': "Show all models...";
    readonly 'settings.loading_models': "Loading models...";
    readonly 'settings.switched': "✓ Switched to {provider}, model: {model}";
    readonly 'settings.model_changed': "✓ Model changed to {model}";
    readonly 'settings.lang_prompt': "Current language: {lang}\n\nChoose:";
    readonly 'settings.lang_auto': "Auto-detect";
    readonly 'settings.lang_changed': "✓ Language changed to {lang}";
    readonly 'settings.lang_other': "✏️ Other...";
    readonly 'settings.lang_custom_prompt': "Type the language name (e.g. Ukrainian, Japanese, Hindi):\n\nSend /cancel to cancel.";
    readonly 'settings.resources_title': "📈 Resources";
    readonly 'settings.alerts_status': "Alerts";
    readonly 'settings.cpu_label': "CPU threshold";
    readonly 'settings.ram_label': "RAM threshold";
    readonly 'settings.disk_label': "Disk threshold";
    readonly 'settings.alerts_toggle': "🔔 Alerts: {status}";
    readonly 'settings.cpu_btn': "📊 CPU threshold";
    readonly 'settings.ram_btn': "💾 RAM threshold";
    readonly 'settings.disk_btn': "💿 Disk threshold";
    readonly 'settings.threshold_prompt': "Current {resource} alert threshold: {value}%\n\nAlert when usage exceeds:";
    readonly 'settings.threshold_custom': "✏️ Custom";
    readonly 'settings.threshold_set': "✓ {resource} alert threshold set to {value}%";
    readonly 'settings.threshold_custom_prompt': "✏️ Custom {resource} threshold\n\nPlease send a number between 1 and 100 (e.g., 85)\n\nSend /cancel to cancel.";
    readonly 'reset.warning': "⚠️ This will erase all data: AI provider, profile, saved credentials, conversation history, tasks, and usage stats.\n\nYou will go through the initial setup again.\n\nAre you sure?";
    readonly 'reset.confirm_btn': "Yes, reset everything";
    readonly 'reset.cancel_btn': "« Cancel";
    readonly 'reset.done': "✓ All data has been erased.";
    readonly 'cmd.start': "Hi! I'm Zaruka, your personal AI assistant.\n\nJust send me a message and I'll help you with tasks, weather, and more.\n\nCommands:\n/settings — Configure model, language, thresholds\n/usage — API token usage\n/resources — System resource usage\n/help — Show this help";
    readonly 'cmd.help': "🤖 Zaruka — Commands\n\n/settings — Configure model, language, alert thresholds\n/usage — API token usage\n/resources — Show current CPU, RAM, disk usage\n/version — Show app version\n/help — Show this help\n\nOr just send me any message!";
    readonly 'cmd.usage_title': "📊 Usage Statistics — Select a time period:";
    readonly 'cmd.usage_no_ai': "AI provider is not configured yet. Send /start to set it up.";
    readonly 'cmd.usage_local': "💡 Usage Tracking\n\nYou're using a local/self-hosted model.\nNo usage limits apply — unlimited requests!";
    readonly 'cmd.usage_header': "📊 Usage — {period}";
    readonly 'cmd.usage_no_data': "No usage data for this period.";
    readonly 'cmd.usage_requests': "Requests";
    readonly 'cmd.usage_input': "Input";
    readonly 'cmd.usage_output': "Output";
    readonly 'cmd.usage_total': "Total";
    readonly 'cmd.usage_per_model': "Per model";
    readonly 'cmd.usage_failed': "Failed to load usage data: {error}";
    readonly 'period.today': "Today";
    readonly 'period.week': "Week";
    readonly 'period.month': "Month";
    readonly 'period.year': "Year";
    readonly 'cmd.cancel_done': "❌ Cancelled.";
    readonly 'cmd.cancel_threshold': "❌ Cancelled. Threshold not changed.";
    readonly 'cmd.cancel_nothing': "Nothing to cancel.";
    readonly 'error.no_ai': "AI is not configured yet. Send /start to set up.";
    readonly 'error.voice_transcribe': "Could not transcribe the voice message. Please try again.";
    readonly 'error.voice_failed': "Sorry, something went wrong processing your voice message.";
    readonly 'error.processing': "❌ Error processing your message.\n\nPlease try again. If the problem persists, check /settings or contact support.";
    readonly 'error.threshold_invalid': "❌ Invalid number. Please send a number between 1 and 100.\n\nSend /cancel to cancel.";
    readonly 'cmd_desc.start': "Start the bot";
    readonly 'cmd_desc.settings': "Configure model, language, thresholds";
    readonly 'cmd_desc.usage': "API token usage";
    readonly 'cmd_desc.resources': "System resource usage";
    readonly 'cmd_desc.version': "Show app version";
    readonly 'cmd_desc.help': "Show help";
};
export type UIKey = keyof typeof UI_STRINGS;
/**
 * Look up a translated UI string with optional {placeholder} interpolation.
 * Returns cached translation if available, otherwise falls back to English.
 */
export declare function t(cm: ConfigManager, key: UIKey, params?: Record<string, string>): string;
/**
 * Translate all UI strings to the given language using the AI model.
 * Returns a map of key → translated string.
 */
export declare function translateUI(model: LanguageModel, language: string): Promise<Record<string, string>>;
//# sourceMappingURL=i18n.d.ts.map