import { Markup, type Telegraf } from 'telegraf';
import type { ConfigManager } from '../core/config-manager.js';
import type { BotContext } from './bot-context.js';
export declare function settingsText(configManager: ConfigManager): string;
export declare function settingsKeyboard(configManager: ConfigManager): Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
export declare function registerSettingsCallbacks(bot: Telegraf, ctx: BotContext): void;
//# sourceMappingURL=settings.d.ts.map