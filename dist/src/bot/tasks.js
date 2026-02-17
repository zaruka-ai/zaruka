import { Markup } from 'telegraf';
import { t } from './i18n.js';
const PAGE_SIZE = 5;
function statusIcon(task) {
    if (task.status === 'completed')
        return '✅';
    if (task.status === 'paused')
        return '⏸';
    if (task.recurrence)
        return '🔄';
    return '📌';
}
function formatDate(dateStr) {
    const [, mm, dd] = dateStr.split('-');
    return `${dd}.${mm}`;
}
function formatDateFull(dateStr) {
    const [yyyy, mm, dd] = dateStr.split('-');
    return `${dd}.${mm}.${yyyy}`;
}
// --- List view ---
function taskButtonLabel(task) {
    const icon = statusIcon(task);
    const meta = [];
    if (task.due_date)
        meta.push(formatDate(task.due_date));
    if (task.due_time && task.due_time !== '12:00')
        meta.push(task.due_time);
    if (task.recurrence)
        meta.push(`🔁`);
    if (task.action)
        meta.push('🤖');
    const suffix = meta.length > 0 ? ` · ${meta.join(' ')}` : '';
    // Telegram callback button text limit is ~64 chars visible
    const maxTitle = 40 - suffix.length;
    const title = task.title.length > maxTitle ? task.title.slice(0, maxTitle - 1) + '…' : task.title;
    return `${icon} ${title}${suffix}`;
}
export function tasksText(totalActive, filter, isEmpty, cm) {
    if (isEmpty && filter === 'active')
        return t(cm, 'tasks.empty');
    if (isEmpty)
        return t(cm, 'tasks.no_results');
    return t(cm, 'tasks.title', { count: String(totalActive) });
}
export function tasksKeyboard(tasks, filter, page, totalFiltered, cm) {
    const rows = [];
    // Each task = one full-width button
    for (const task of tasks) {
        rows.push([
            Markup.button.callback(taskButtonLabel(task), `task:view:${task.id}`),
        ]);
    }
    // Pagination
    const totalPages = Math.ceil(totalFiltered / PAGE_SIZE);
    if (totalPages > 1) {
        const navRow = [];
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
    const check = (f) => (f === filter ? ' ✓' : '');
    rows.push([
        Markup.button.callback(`${t(cm, 'tasks.filter_active')}${check('active')}`, 'task:list:active:0'),
        Markup.button.callback(`${t(cm, 'tasks.filter_completed')}${check('completed')}`, 'task:list:completed:0'),
        Markup.button.callback(`${t(cm, 'tasks.filter_all')}${check('all')}`, 'task:list:all:0'),
    ]);
    return Markup.inlineKeyboard(rows);
}
// --- Detail view ---
export function taskDetailText(task) {
    const icon = statusIcon(task);
    const lines = [`${icon} ${task.title}`];
    if (task.description)
        lines.push(`\n📝 ${task.description}`);
    const meta = [];
    if (task.due_date) {
        let datePart = `📅 ${formatDateFull(task.due_date)}`;
        if (task.due_time && task.due_time !== '12:00')
            datePart += ` ⏰ ${task.due_time}`;
        meta.push(datePart);
    }
    if (task.recurrence)
        meta.push(`🔁 ${task.recurrence}`);
    if (task.action)
        meta.push('🤖 action');
    if (meta.length > 0)
        lines.push(meta.join('\n'));
    return lines.join('\n');
}
export function taskDetailKeyboard(task, filter, page, cm) {
    const rows = [];
    if (task.status === 'active') {
        const actionRow = [
            Markup.button.callback(t(cm, 'tasks.complete_btn'), `task:done:${task.id}`),
        ];
        if (task.recurrence) {
            actionRow.push(Markup.button.callback(t(cm, 'tasks.pause_btn'), `task:pause:${task.id}`));
        }
        actionRow.push(Markup.button.callback(t(cm, 'tasks.delete_btn'), `task:del:${task.id}`));
        rows.push(actionRow);
    }
    else if (task.status === 'paused') {
        rows.push([
            Markup.button.callback(t(cm, 'tasks.resume_btn'), `task:resume:${task.id}`),
            Markup.button.callback(t(cm, 'tasks.delete_btn'), `task:del:${task.id}`),
        ]);
    }
    else if (task.status === 'completed') {
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
const viewState = new Map();
function getFilteredTasks(ctx, filter) {
    const { taskRepo } = ctx;
    if (filter === 'active') {
        return [
            ...taskRepo.list('active'),
            ...taskRepo.list('paused'),
        ].sort((a, b) => b.id - a.id);
    }
    if (filter === 'completed')
        return taskRepo.list('completed');
    // 'all' — everything except deleted
    return taskRepo.list();
}
async function showList(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
tCtx, ctx, filter, page, method) {
    const { configManager, taskRepo } = ctx;
    const allFiltered = getFilteredTasks(ctx, filter);
    const start = page * PAGE_SIZE;
    const pageTasks = allFiltered.slice(start, start + PAGE_SIZE);
    const totalActive = taskRepo.count('active');
    const chatId = tCtx.chat?.id;
    if (chatId)
        viewState.set(chatId, { filter, page });
    const text = tasksText(totalActive, filter, allFiltered.length === 0, configManager);
    const keyboard = tasksKeyboard(pageTasks, filter, page, allFiltered.length, configManager);
    if (method === 'edit') {
        try {
            await tCtx.editMessageText(text, keyboard);
        }
        catch { /* identical message */ }
    }
    else {
        await tCtx.reply(text, keyboard);
    }
}
export function registerTasksCallbacks(bot, ctx) {
    const { configManager, taskRepo } = ctx;
    // List with filter + page
    bot.action(/^task:list:(active|completed|all):(\d+)$/, async (tCtx) => {
        await tCtx.answerCbQuery();
        const filter = tCtx.match[1];
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
        const state = viewState.get(tCtx.chat.id) ?? { filter: 'active', page: 0 };
        await tCtx.editMessageText(taskDetailText(task), taskDetailKeyboard(task, state.filter, state.page, configManager));
    });
    // Complete task
    bot.action(/^task:done:(\d+)$/, async (tCtx) => {
        const id = parseInt(tCtx.match[1], 10);
        taskRepo.complete(id);
        const state = viewState.get(tCtx.chat.id) ?? { filter: 'active', page: 0 };
        await tCtx.answerCbQuery(t(configManager, 'tasks.completed_msg'));
        await showList(tCtx, ctx, state.filter, state.page, 'edit');
    });
    // Delete task
    bot.action(/^task:del:(\d+)$/, async (tCtx) => {
        const id = parseInt(tCtx.match[1], 10);
        taskRepo.delete(id);
        const state = viewState.get(tCtx.chat.id) ?? { filter: 'active', page: 0 };
        await tCtx.answerCbQuery(t(configManager, 'tasks.deleted_msg'));
        await showList(tCtx, ctx, state.filter, state.page, 'edit');
    });
    // Pause task
    bot.action(/^task:pause:(\d+)$/, async (tCtx) => {
        const id = parseInt(tCtx.match[1], 10);
        taskRepo.pause(id);
        const state = viewState.get(tCtx.chat.id) ?? { filter: 'active', page: 0 };
        await tCtx.answerCbQuery(t(configManager, 'tasks.paused_msg'));
        await showList(tCtx, ctx, state.filter, state.page, 'edit');
    });
    // Resume task
    bot.action(/^task:resume:(\d+)$/, async (tCtx) => {
        const id = parseInt(tCtx.match[1], 10);
        taskRepo.resume(id);
        const state = viewState.get(tCtx.chat.id) ?? { filter: 'active', page: 0 };
        await tCtx.answerCbQuery(t(configManager, 'tasks.resumed_msg'));
        await showList(tCtx, ctx, state.filter, state.page, 'edit');
    });
}
/** Show the tasks list as a new message (for /tasks command). */
export async function showTasksList(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
tCtx, ctx) {
    await showList(tCtx, ctx, 'active', 0, 'reply');
}
//# sourceMappingURL=tasks.js.map