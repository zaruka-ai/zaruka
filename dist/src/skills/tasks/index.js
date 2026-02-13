export class TasksSkill {
    name = 'tasks';
    description = 'Task management — create, list, complete, update, and delete tasks';
    repo;
    tools = [
        {
            name: 'create_task',
            description: 'Create a new task',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Task title' },
                    description: { type: 'string', description: 'Task description (optional)' },
                    due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format (optional)' },
                },
                required: ['title'],
            },
        },
        {
            name: 'list_tasks',
            description: 'List tasks, optionally filtered by status',
            parameters: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['active', 'completed'], description: 'Filter by status (default: all non-deleted)' },
                },
            },
        },
        {
            name: 'complete_task',
            description: 'Mark a task as completed',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'number', description: 'Task ID' },
                },
                required: ['id'],
            },
        },
        {
            name: 'delete_task',
            description: 'Delete a task',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'number', description: 'Task ID' },
                },
                required: ['id'],
            },
        },
        {
            name: 'update_task',
            description: 'Update a task',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'number', description: 'Task ID' },
                    title: { type: 'string', description: 'New title' },
                    description: { type: 'string', description: 'New description' },
                    due_date: { type: 'string', description: 'New due date in YYYY-MM-DD format' },
                },
                required: ['id'],
            },
        },
    ];
    constructor(repo) {
        this.repo = repo;
    }
    async execute(toolName, params) {
        switch (toolName) {
            case 'create_task': {
                const task = this.repo.create({
                    title: params.title,
                    description: params.description,
                    due_date: params.due_date,
                });
                return JSON.stringify({ success: true, task: { id: task.id, title: task.title, due_date: task.due_date } });
            }
            case 'list_tasks': {
                const tasks = this.repo.list(params.status);
                if (tasks.length === 0) {
                    return JSON.stringify({ tasks: [], message: 'No tasks found' });
                }
                return JSON.stringify({
                    tasks: tasks.map(t => ({
                        id: t.id,
                        title: t.title,
                        due_date: t.due_date,
                        status: t.status,
                    })),
                });
            }
            case 'complete_task': {
                const task = this.repo.complete(params.id);
                if (!task)
                    return JSON.stringify({ success: false, error: 'Task not found' });
                return JSON.stringify({ success: true, task: { id: task.id, title: task.title, status: task.status } });
            }
            case 'delete_task': {
                const ok = this.repo.delete(params.id);
                return JSON.stringify({ success: ok });
            }
            case 'update_task': {
                const { id, ...rest } = params;
                const task = this.repo.update(id, rest);
                if (!task)
                    return JSON.stringify({ success: false, error: 'Task not found' });
                return JSON.stringify({ success: true, task: { id: task.id, title: task.title, due_date: task.due_date } });
            }
            default:
                return JSON.stringify({ error: `Unknown tool: ${toolName}` });
        }
    }
}
//# sourceMappingURL=index.js.map