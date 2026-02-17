import { generateText, type LanguageModel } from 'ai';
import type { ConfigManager } from '../core/config-manager.js';

/**
 * All translatable UI strings with English defaults.
 * Keys use dot notation: section.name
 * Values support {placeholder} interpolation.
 */
export const UI_STRINGS = {
  // Settings — main menu
  'settings.title': '⚙️ Settings',
  'settings.model_label': 'Model',
  'settings.language_label': 'Language',
  'settings.alerts_label': 'Resource alerts',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.model_btn': '🧠 Model',
  'settings.lang_btn': '🌐 Language',
  'settings.resources_btn': '📈 Resources',
  'settings.reset_btn': '🗑 Reset all data',
  'settings.back': '« Back',

  // Settings — provider / model
  'settings.choose_provider': 'Choose a provider:',
  'settings.choose_model': 'Choose a model:',
  'settings.show_all': 'Show all models...',
  'settings.loading_models': 'Loading models...',
  'settings.switched': '✓ Switched to {provider}, model: {model}',
  'settings.model_changed': '✓ Model changed to {model}',

  // Settings — language
  'settings.lang_prompt': 'Current language: {lang}\n\nChoose:',
  'settings.lang_auto': 'Auto-detect',
  'settings.lang_changed': '✓ Language changed to {lang}',
  'settings.lang_other': '✏️ Other...',
  'settings.lang_custom_prompt': 'Type the language name (e.g. Ukrainian, Japanese, Hindi):\n\nSend /cancel to cancel.',

  // Settings — resources
  'settings.resources_title': '📈 Resources',
  'settings.alerts_status': 'Alerts',
  'settings.cpu_label': 'CPU threshold',
  'settings.ram_label': 'RAM threshold',
  'settings.disk_label': 'Disk threshold',
  'settings.alerts_toggle': '🔔 Alerts: {status}',
  'settings.cpu_btn': '📊 CPU threshold',
  'settings.ram_btn': '💾 RAM threshold',
  'settings.disk_btn': '💿 Disk threshold',
  'settings.threshold_prompt': 'Current {resource} alert threshold: {value}%\n\nAlert when usage exceeds:',
  'settings.threshold_custom': '✏️ Custom',
  'settings.threshold_set': '✓ {resource} alert threshold set to {value}%',
  'settings.threshold_custom_prompt': '✏️ Custom {resource} threshold\n\nPlease send a number between 1 and 100 (e.g., 85)\n\nSend /cancel to cancel.',

  // Settings — reset
  'reset.warning': '⚠️ This will erase all data: AI provider, profile, saved credentials, conversation history, tasks, and usage stats.\n\nYou will go through the initial setup again.\n\nAre you sure?',
  'reset.confirm_btn': 'Yes, reset everything',
  'reset.cancel_btn': '« Cancel',
  'reset.done': '✓ All data has been erased.',

  // /start
  'cmd.start': "Hi! I'm Zaruka, your personal AI assistant.\n\nJust send me a message and I'll help you with tasks, weather, and more.\n\nCommands:\n/settings — Configure model, language, thresholds\n/tasks — View and manage tasks\n/usage — API token usage\n/resources — System resource usage\n/help — Show this help",

  // /help
  'cmd.help': '🤖 Zaruka — Commands\n\n/settings — Configure model, language, alert thresholds\n/tasks — View and manage tasks\n/usage — API token usage\n/resources — Show current CPU, RAM, disk usage\n/version — Show app version\n/help — Show this help\n\nOr just send me any message!',

  // /usage
  'cmd.usage_title': '📊 Usage Statistics — Select a time period:',
  'cmd.usage_no_ai': 'AI provider is not configured yet. Send /start to set it up.',
  'cmd.usage_local': "💡 Usage Tracking\n\nYou're using a local/self-hosted model.\nNo usage limits apply — unlimited requests!",
  'cmd.usage_header': '📊 Usage — {period}',
  'cmd.usage_no_data': 'No usage data for this period.',
  'cmd.usage_requests': 'Requests',
  'cmd.usage_input': 'Input',
  'cmd.usage_output': 'Output',
  'cmd.usage_total': 'Total',
  'cmd.usage_per_model': 'Per model',
  'cmd.usage_failed': 'Failed to load usage data: {error}',

  // Period labels (used for buttons and headers)
  'period.today': 'Today',
  'period.week': 'Week',
  'period.month': 'Month',
  'period.year': 'Year',

  // /cancel
  'cmd.cancel_done': '❌ Cancelled.',
  'cmd.cancel_threshold': '❌ Cancelled. Threshold not changed.',
  'cmd.cancel_nothing': 'Nothing to cancel.',

  // Errors
  'error.no_ai': 'AI is not configured yet. Send /start to set up.',
  'error.voice_transcribe': 'Could not transcribe the voice message. Please try again.',
  'error.voice_failed': 'Sorry, something went wrong processing your voice message.',
  'error.processing': '❌ Error processing your message.\n\nPlease try again. If the problem persists, check /settings or contact support.',
  'error.threshold_invalid': '❌ Invalid number. Please send a number between 1 and 100.\n\nSend /cancel to cancel.',

  // Tasks UI
  'tasks.title': '📋 Tasks ({count} active)',
  'tasks.empty': 'No tasks yet. Ask me to create one!',
  'tasks.no_results': 'No tasks match this filter.',
  'tasks.filter_active': 'Active',
  'tasks.filter_completed': 'Completed',
  'tasks.filter_all': 'All',
  'tasks.prev_btn': '« Prev',
  'tasks.next_btn': 'Next »',
  'tasks.complete_btn': '✅ Complete',
  'tasks.delete_btn': '🗑 Delete',
  'tasks.pause_btn': '⏸ Pause',
  'tasks.resume_btn': '▶️ Resume',
  'tasks.back_btn': '« Back',
  'tasks.completed_msg': '✅ Task completed.',
  'tasks.deleted_msg': '🗑 Task deleted.',
  'tasks.paused_msg': '⏸ Task paused.',
  'tasks.resumed_msg': '▶️ Task resumed.',
  'tasks.not_found': 'Task not found.',

  // Telegram command descriptions (shown in the bot menu)
  'cmd_desc.start': 'Start the bot',
  'cmd_desc.settings': 'Configure model, language, thresholds',
  'cmd_desc.tasks': 'View and manage tasks',
  'cmd_desc.usage': 'API token usage',
  'cmd_desc.resources': 'System resource usage',
  'cmd_desc.version': 'Show app version',
  'cmd_desc.help': 'Show help',
} as const;

export type UIKey = keyof typeof UI_STRINGS;

/**
 * Look up a translated UI string with optional {placeholder} interpolation.
 * Returns cached translation if available, otherwise falls back to English.
 */
export function t(cm: ConfigManager, key: UIKey, params?: Record<string, string>): string {
  const cached = cm.getTranslation(key);
  const str = cached ?? UI_STRINGS[key];
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
}

/** Check if the cached translations cover all current UI_STRINGS keys. */
export function translationCacheComplete(cm: ConfigManager): boolean {
  const keys = Object.keys(UI_STRINGS);
  return keys.every((k) => cm.getTranslation(k) !== undefined);
}

/**
 * Translate all UI strings to the given language using the AI model.
 * Returns a map of key → translated string.
 */
export async function translateUI(
  model: LanguageModel,
  language: string,
): Promise<Record<string, string>> {
  const { text } = await generateText({
    model,
    prompt: [
      `Translate the following UI strings from English to ${language}.`,
      'These are button labels and messages for a Telegram bot.',
      '',
      'Rules:',
      '- Keep all emoji prefixes exactly as they are (e.g. ⚙️, 🧠, ✓, ❌)',
      '- Keep all {placeholders} exactly as they are (e.g. {model}, {lang})',
      '- Keep all /commands exactly as they are (e.g. /settings, /start)',
      '- Keep newline characters (\\n) exactly as they are',
      '- Translate ONLY the human-readable text',
      '',
      'Return ONLY a valid JSON object mapping each key to its translation.',
      'No markdown code fences, no explanation — just the JSON.',
      '',
      JSON.stringify(UI_STRINGS, null, 2),
    ].join('\n'),
    maxOutputTokens: 4096,
  });

  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse translation response');
  return JSON.parse(jsonMatch[0]);
}
