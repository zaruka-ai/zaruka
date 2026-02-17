import { Markup, type Telegraf } from 'telegraf';
import type { Task } from '../core/types.js';
import type { BotContext } from './bot-context.js';
type Filter = 'active' | 'completed' | 'all';
export declare function tasksText(totalActive: number, filter: Filter, isEmpty: boolean, cm: BotContext['configManager']): string;
export declare function tasksKeyboard(tasks: Task[], filter: Filter, page: number, totalFiltered: number, cm: BotContext['configManager']): Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
export declare function taskDetailText(task: Task): string;
export declare function taskDetailKeyboard(task: Task, filter: Filter, page: number, cm: BotContext['configManager']): Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
export declare function registerTasksCallbacks(bot: Telegraf, ctx: BotContext): void;
/** Show the tasks list as a new message (for /tasks command). */
export declare function showTasksList(tCtx: any, ctx: BotContext): Promise<void>;
export {};
//# sourceMappingURL=tasks.d.ts.map