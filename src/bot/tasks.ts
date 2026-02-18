import rrule from 'rrule';
import { Markup, type Telegraf } from 'telegraf';
import type { Task } from '../core/types.js';
import type { BotContext } from './bot-context.js';
import { t } from './i18n.js';
import { normalizeRecurrence } from '../db/repository.js';

const { RRule } = rrule;
const PAGE_SIZE = 5;

type Filter = 'active' | 'completed' | 'all';

function statusIcon(task: Task): string {
  if (task.status === 'completed') return '✅';
  if (task.status === 'paused') return '⏸';
  if (task.recurrence) return '🔄';
  return '📌';
}

function formatDate(dateStr: string): string {
  const [, mm, dd] = dateStr.split('-');
  return `${dd}.${mm}`;
}

function formatDateFull(dateStr: string): string {
  const [yyyy, mm, dd] = dateStr.split('-');
  return `${dd}.${mm}.${yyyy}`;
}

function recurrenceToText(recurrence: string): string {
  try {
    const normalized = normalizeRecurrence(recurrence);
    const rule = new RRule({ ...RRule.parseString(normalized), dtstart: new Date() });
    return rule.toText();
  } catch {
    return recurrence;
  }
}

// --- List view ---

function taskButtonLabel(task: Task): string {
  const icon = statusIcon(task);
  const meta: string[] = [];
  if (task.due_date) meta.push(formatDate(task.due_date));
  if (task.due_time && task.due_time !== '12:00') meta.push(task.due_time);
  if (task.recurrence) meta.push(`🔁`);
  if (task.action) meta.push('🤖');
  const suffix = meta.length > 0 ? ` · ${meta.join(' ')}` : '';
  // Telegram callback button text limit is ~64 chars visible
  const maxTitle = 40 - suffix.length;
  const title = task.title.length > maxTitle ? task.title.slice(0, maxTitle - 1) + '…' : task.title;
  return `${icon} ${title}${suffix}`;
}

export function tasksText(totalActive: number, filter: Filter, isEmpty: boolean, cm: BotContext['configManager']): string {
  if (isEmpty && filter === 'active') return t(cm, 'tasks.empty');
  if (isEmpty) return t(cm, 'tasks.no_results');
  return t(cm, 'tasks.title', { count: String(totalActive) });
}

export function tasksKeyboard(
  tasks: Task[],
  filter: Filter,
  page: number,
  totalFiltered: number,
  cm: BotContext['configManager'],
) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];

  // Each task = one full-width button
  for (const task of tasks) {
    rows.push([
      Markup.button.callback(taskButtonLabel(task), `task:view:${task.id}`),
    ]);
  }

  // Pagination
  const totalPages = Math.ceil(totalFiltered / PAGE_SIZE);
  if (totalPages > 1) {
    const navRow: ReturnType<typeof Markup.button.callback>[] = [];
    if (page > 0) {
      navRow.push(Markup.button.callback(t(cm, 'tasks.prev_btn'), `task:list:${filter}:${page - 1}`));
    }
    navRow.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'task:noop'));
    if (page < totalPages - 1) {
      navRow.push(Markup.button.callback(t(cm, 'tasks.next_btn'), `task:list:${filter}:${page + 1}`));
    }
    rows.push(navRow);
  }

  // Filter buttons
  const check = (f: Filter) => (f === filter ? ' ✓' : '');
  rows.push([
    Markup.button.callback(`${t(cm, 'tasks.filter_active')}${check('active')}`, 'task:list:active:0'),
    Markup.button.callback(`${t(cm, 'tasks.filter_completed')}${check('completed')}`, 'task:list:completed:0'),
    Markup.button.callback(`${t(cm, 'tasks.filter_all')}${check('all')}`, 'task:list:all:0'),
  ]);

  return Markup.inlineKeyboard(rows);
}

// --- Detail view ---

export function taskDetailText(task: Task): string {
  const icon = statusIcon(task);
  const lines = [`${icon} ${task.title}`];
  if (task.description) lines.push(`\n📝 ${task.description}`);
  const meta: string[] = [];
  if (task.due_date) {
    let datePart = `📅 ${formatDateFull(task.due_date)}`;
    if (task.due_time && task.due_time !== '12:00') datePart += ` ⏰ ${task.due_time}`;
    meta.push(datePart);
  }
  if (task.recurrence) meta.push(`🔁 ${recurrenceToText(task.recurrence)}`);
  if (task.action) meta.push('🤖 action');
  if (meta.length > 0) lines.push(meta.join('\n'));
  return lines.join('\n');
}

export function taskDetailKeyboard(task: Task, filter: Filter, page: number, cm: BotContext['configManager']) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];

  if (task.status === 'active') {
    const actionRow: ReturnType<typeof Markup.button.callback>[] = [
      Markup.button.callback(t(cm, 'tasks.complete_btn'), `task:done:${task.id}`),
    ];
    if (task.recurrence) {
      actionRow.push(Markup.button.callback(t(cm, 'tasks.pause_btn'), `task:pause:${task.id}`));
    }
    actionRow.push(Markup.button.callback(t(cm, 'tasks.delete_btn'), `task:del:${task.id}`));
    rows.push(actionRow);
  } else if (task.status === 'paused') {
    rows.push([
      Markup.button.callback(t(cm, 'tasks.resume_btn'), `task:resume:${task.id}`),
      Markup.button.callback(t(cm, 'tasks.delete_btn'), `task:del:${task.id}`),
    ]);
  } else if (task.status === 'completed') {
    rows.push([
      Markup.button.callback(t(cm, 'tasks.delete_btn'), `task:del:${task.id}`),
    ]);
  }

  rows.push([
    Markup.button.callback(t(cm, 'tasks.back_btn'), `task:list:${filter}:${page}`),
  ]);

  return Markup.inlineKeyboard(rows);
}

// --- Callbacks ---

/** Per-chat state: which filter/page the user was on when they clicked a task. */
const viewState = new Map<number, { filter: Filter; page: number }>();

function getFilteredTasks(ctx: BotContext, filter: Filter): Task[] {
  const { taskRepo } = ctx;
  if (filter === 'active') {
    return [
      ...taskRepo.list('active'),
      ...taskRepo.list('paused'),
    ].sort((a, b) => b.id - a.id);
  }
  if (filter === 'completed') return taskRepo.list('completed');
  // 'all' — everything except deleted
  return taskRepo.list();
}

async function showList(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tCtx: any,
  ctx: BotContext,
  filter: Filter,
  page: number,
  method: 'edit' | 'reply',
) {
  const { configManager, taskRepo } = ctx;
  const allFiltered = getFilteredTasks(ctx, filter);
  const start = page * PAGE_SIZE;
  const pageTasks = allFiltered.slice(start, start + PAGE_SIZE);
  const totalActive = taskRepo.count('active');

  const chatId = tCtx.chat?.id;
  if (chatId) viewState.set(chatId, { filter, page });

  const text = tasksText(totalActive, filter, allFiltered.length === 0, configManager);
  const keyboard = tasksKeyboard(pageTasks, filter, page, allFiltered.length, configManager);

  if (method === 'edit') {
    try { await tCtx.editMessageText(text, keyboard); } catch { /* identical message */ }
  } else {
    await tCtx.reply(text, keyboard);
  }
}

export function registerTasksCallbacks(bot: Telegraf, ctx: BotContext): void {
  const { configManager, taskRepo } = ctx;

  // List with filter + page
  bot.action(/^task:list:(active|completed|all):(\d+)$/, async (tCtx) => {
    await tCtx.answerCbQuery();
    const filter = tCtx.match[1] as Filter;
    const page = parseInt(tCtx.match[2], 10);
    await showList(tCtx, ctx, filter, page, 'edit');
  });

  // Noop for page indicator button
  bot.action('task:noop', async (tCtx) => {
    await tCtx.answerCbQuery();
  });

  // View task detail
  bot.action(/^task:view:(\d+)$/, async (tCtx) => {
    await tCtx.answerCbQuery();
    const id = parseInt(tCtx.match[1], 10);
    const task = taskRepo.getById(id);
    if (!task) {
      await tCtx.editMessageText(t(configManager, 'tasks.not_found'));
      return;
    }
    const state = viewState.get(tCtx.chat!.id) ?? { filter: 'active' as Filter, page: 0 };
    await tCtx.editMessageText(
      taskDetailText(task),
      taskDetailKeyboard(task, state.filter, state.page, configManager),
    );
  });

  // Complete task
  bot.action(/^task:done:(\d+)$/, async (tCtx) => {
    const id = parseInt(tCtx.match[1], 10);
    taskRepo.complete(id);
    const state = viewState.get(tCtx.chat!.id) ?? { filter: 'active' as Filter, page: 0 };
    await tCtx.answerCbQuery(t(configManager, 'tasks.completed_msg'));
    await showList(tCtx, ctx, state.filter, state.page, 'edit');
  });

  // Delete task
  bot.action(/^task:del:(\d+)$/, async (tCtx) => {
    const id = parseInt(tCtx.match[1], 10);
    taskRepo.delete(id);
    const state = viewState.get(tCtx.chat!.id) ?? { filter: 'active' as Filter, page: 0 };
    await tCtx.answerCbQuery(t(configManager, 'tasks.deleted_msg'));
    await showList(tCtx, ctx, state.filter, state.page, 'edit');
  });

  // Pause task
  bot.action(/^task:pause:(\d+)$/, async (tCtx) => {
    const id = parseInt(tCtx.match[1], 10);
    taskRepo.pause(id);
    const state = viewState.get(tCtx.chat!.id) ?? { filter: 'active' as Filter, page: 0 };
    await tCtx.answerCbQuery(t(configManager, 'tasks.paused_msg'));
    await showList(tCtx, ctx, state.filter, state.page, 'edit');
  });

  // Resume task
  bot.action(/^task:resume:(\d+)$/, async (tCtx) => {
    const id = parseInt(tCtx.match[1], 10);
    taskRepo.resume(id);
    const state = viewState.get(tCtx.chat!.id) ?? { filter: 'active' as Filter, page: 0 };
    await tCtx.answerCbQuery(t(configManager, 'tasks.resumed_msg'));
    await showList(tCtx, ctx, state.filter, state.page, 'edit');
  });
}

/** Show the tasks list as a new message (for /tasks command). */
export async function showTasksList(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tCtx: any,
  ctx: BotContext,
): Promise<void> {
  await showList(tCtx, ctx, 'active', 0, 'reply');
}
