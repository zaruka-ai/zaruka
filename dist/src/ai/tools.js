import { tool } from 'ai';
import { z } from 'zod/v4';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const ENV_FILE = join(ZARUKA_DIR, '.env');
async function geocode(location) {
    const url = `${GEOCODING_URL}?name=${encodeURIComponent(location)}&count=1&language=en`;
    const res = await fetch(url);
    const data = (await res.json());
    return data.results?.[0] ?? null;
}
export function createAllTools(deps) {
    return {
        ...createTaskTools(deps.taskRepo),
        ...createWeatherTools(),
        ...createWebTools(),
        ...createResourceTools(),
        ...createShellTools(),
        ...createHistoryTools(deps.messageRepo, deps.configManager),
        ...createUsageTools(deps.usageRepo),
        ...createCredentialTools(),
        ...createExecuteSkillTools(deps.skillsDir),
        ...createProfileTools(deps.configManager),
        ...createMemoryTools(deps.memoryDir),
    };
}
// === Task Tools ===
function createTaskTools(repo) {
    return {
        create_task: tool({
            description: 'Create a new task. Can be a one-time reminder, recurring reminder, or a recurring bot action (with an AI instruction). '
                + 'IMPORTANT: Before creating, always call list_tasks first to check if a similar task already exists. '
                + 'If it does, use update_task instead of creating a duplicate.',
            inputSchema: z.object({
                title: z.string().describe('Task title'),
                description: z.string().optional().describe('Task description'),
                due_date: z.string().optional().describe('Due date in YYYY-MM-DD format'),
                due_time: z.string().optional().describe('Due time in HH:MM format (default: 12:00)'),
                recurrence: z.string().optional().describe("Recurrence rule: 'daily', 'weekly', 'monthly', 'yearly', or null for one-time"),
                action: z.string().optional().describe('AI instruction for the bot to execute on schedule (null = simple reminder)'),
            }),
            execute: async (args) => {
                // Guard against duplicate active tasks with a similar title
                const existing = repo.findActiveByTitle(args.title);
                if (existing) {
                    return JSON.stringify({
                        success: true,
                        duplicate: true,
                        message: `An active task with a similar title already exists (id=${existing.id}). Use update_task to modify it instead.`,
                        task: {
                            id: existing.id, title: existing.title,
                            due_date: existing.due_date, due_time: existing.due_time,
                            recurrence: existing.recurrence, action: existing.action ? '(action set)' : null,
                        },
                    });
                }
                const task = repo.create({
                    title: args.title,
                    description: args.description,
                    due_date: args.due_date,
                    due_time: args.due_time,
                    recurrence: args.recurrence,
                    action: args.action,
                });
                return JSON.stringify({
                    success: true,
                    task: {
                        id: task.id, title: task.title,
                        due_date: task.due_date, due_time: task.due_time,
                        recurrence: task.recurrence, action: task.action ? '(action set)' : null,
                    },
                });
            },
        }),
        list_tasks: tool({
            description: 'List tasks, optionally filtered by status',
            inputSchema: z.object({
                status: z.enum(['active', 'completed']).optional().describe('Filter by status (default: all non-deleted)'),
            }),
            execute: async (args) => {
                const tasks = repo.list(args.status);
                if (tasks.length === 0)
                    return JSON.stringify({ tasks: [], message: 'No tasks found' });
                return JSON.stringify({
                    tasks: tasks.map((t) => ({
                        id: t.id, title: t.title,
                        due_date: t.due_date, due_time: t.due_time,
                        recurrence: t.recurrence, has_action: !!t.action,
                        status: t.status,
                    })),
                });
            },
        }),
        complete_task: tool({
            description: 'Mark a task as completed',
            inputSchema: z.object({ id: z.number().describe('Task ID') }),
            execute: async (args) => {
                const task = repo.complete(args.id);
                return JSON.stringify(task
                    ? { success: true, task: { id: task.id, title: task.title, status: task.status } }
                    : { success: false, error: 'Task not found' });
            },
        }),
        delete_task: tool({
            description: 'Delete a task',
            inputSchema: z.object({ id: z.number().describe('Task ID') }),
            execute: async (args) => JSON.stringify({ success: repo.delete(args.id) }),
        }),
        update_task: tool({
            description: 'Update a task',
            inputSchema: z.object({
                id: z.number().describe('Task ID'),
                title: z.string().optional().describe('New title'),
                description: z.string().optional().describe('New description'),
                due_date: z.string().optional().describe('New due date in YYYY-MM-DD format'),
                due_time: z.string().optional().describe('New due time in HH:MM format'),
                recurrence: z.string().optional().describe("Recurrence rule: 'daily', 'weekly', 'monthly', 'yearly', or null"),
                action: z.string().optional().describe('AI instruction for the bot to execute on schedule'),
            }),
            execute: async (args) => {
                const { id, ...rest } = args;
                const task = repo.update(id, rest);
                return JSON.stringify(task
                    ? {
                        success: true,
                        task: {
                            id: task.id, title: task.title,
                            due_date: task.due_date, due_time: task.due_time,
                            recurrence: task.recurrence,
                        },
                    }
                    : { success: false, error: 'Task not found' });
            },
        }),
    };
}
// === Weather Tools ===
function createWeatherTools() {
    return {
        get_weather: tool({
            description: 'Get weather forecast for a location',
            inputSchema: z.object({
                location: z.string().describe('City or place name'),
                date: z.string().optional().describe('Date in YYYY-MM-DD format (optional, default: today)'),
            }),
            execute: async (args) => {
                const geo = await geocode(args.location);
                if (!geo)
                    return JSON.stringify({ error: `Location "${args.location}" not found` });
                const params = new URLSearchParams({
                    latitude: String(geo.latitude),
                    longitude: String(geo.longitude),
                    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weathercode',
                    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weathercode',
                    timezone: 'auto',
                    forecast_days: '7',
                });
                const res = await fetch(`${WEATHER_URL}?${params}`);
                const data = (await res.json());
                if (args.date) {
                    const daily = data.daily;
                    const idx = daily.time.indexOf(args.date);
                    if (idx >= 0) {
                        return JSON.stringify({
                            location: `${geo.name}, ${geo.country}`,
                            date: args.date,
                            temperature_max: daily.temperature_2m_max[idx],
                            temperature_min: daily.temperature_2m_min[idx],
                            precipitation_mm: daily.precipitation_sum[idx],
                            wind_speed_max_kmh: daily.wind_speed_10m_max[idx],
                        });
                    }
                }
                return JSON.stringify({
                    location: `${geo.name}, ${geo.country}`,
                    current: data.current,
                    daily_forecast: data.daily,
                });
            },
        }),
        get_marine_conditions: tool({
            description: 'Get marine/ocean conditions (wave height, period, direction) for a coastal location',
            inputSchema: z.object({
                location: z.string().describe('Coastal city or place name'),
                date: z.string().optional().describe('Date in YYYY-MM-DD format (optional, default: today)'),
            }),
            execute: async (args) => {
                const geo = await geocode(args.location);
                if (!geo)
                    return JSON.stringify({ error: `Location "${args.location}" not found` });
                const params = new URLSearchParams({
                    latitude: String(geo.latitude),
                    longitude: String(geo.longitude),
                    daily: 'wave_height_max,wave_period_max,wave_direction_dominant',
                    timezone: 'auto',
                    forecast_days: '7',
                });
                const res = await fetch(`${MARINE_URL}?${params}`);
                const data = (await res.json());
                if (args.date) {
                    const daily = data.daily;
                    const idx = daily.time.indexOf(args.date);
                    if (idx >= 0) {
                        return JSON.stringify({
                            location: `${geo.name}, ${geo.country}`,
                            date: args.date,
                            wave_height_max_m: daily.wave_height_max[idx],
                            wave_period_max_s: daily.wave_period_max[idx],
                            wave_direction: daily.wave_direction_dominant[idx],
                        });
                    }
                }
                return JSON.stringify({
                    location: `${geo.name}, ${geo.country}`,
                    marine_forecast: data.daily,
                });
            },
        }),
    };
}
// === Web Tools ===
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
function stripHtml(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/** Simple search cache to avoid hitting rate limits on repeated queries. */
const searchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** Search via DuckDuckGo HTML endpoint. */
async function searchDuckDuckGo(query) {
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) });
    const html = await resp.text();
    const uddgMatches = [...html.matchAll(/uddg=([^&"]+)/g)];
    const rawUrls = uddgMatches
        .map((m) => { try {
        return decodeURIComponent(m[1]);
    }
    catch {
        return '';
    } })
        .filter((u) => u.startsWith('http') && !u.includes('duckduckgo.com'));
    const urls = [...new Set(rawUrls)].slice(0, 8);
    const titleMatches = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\//g)];
    const snippetMatches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\//g)];
    const results = [];
    for (let i = 0; i < urls.length; i++) {
        const title = titleMatches[i] ? stripHtml(titleMatches[i][1]).slice(0, 200) : '';
        const snippet = snippetMatches[i] ? stripHtml(snippetMatches[i][1]).slice(0, 300) : '';
        results.push({ title, url: urls[i], snippet });
    }
    return results;
}
/** Fallback: search via Brave Search API (requires BRAVE_API_KEY). Retries on 429. */
async function searchBrave(query) {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey)
        throw new Error('BRAVE_API_KEY not set');
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '8');
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0)
            await new Promise((r) => setTimeout(r, attempt * 1500));
        const resp = await fetch(url.toString(), {
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'X-Subscription-Token': apiKey,
            },
            signal: AbortSignal.timeout(10000),
        });
        if (resp.status === 429) {
            lastErr = new Error('Brave API: 429 rate limited');
            continue;
        }
        if (!resp.ok)
            throw new Error(`Brave API: ${resp.status}`);
        const data = await resp.json();
        return (data.web?.results ?? []).slice(0, 8).map((r) => ({
            title: (r.title ?? '').slice(0, 200),
            url: r.url,
            snippet: (r.description ?? '').slice(0, 300),
        }));
    }
    throw lastErr ?? new Error('Brave API: max retries');
}
function createWebTools() {
    return {
        web_search: tool({
            description: 'Search the web. Returns URLs and text snippets. '
                + 'Use this when you need current/up-to-date information: prices, services, news, documentation, etc.',
            inputSchema: z.object({
                query: z.string().describe('Search query'),
            }),
            execute: async (args) => {
                // Check cache first
                const cached = searchCache.get(args.query);
                if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
                    return JSON.stringify({ results: cached.results });
                }
                // Try Brave first (fast), fall back to DuckDuckGo
                const providers = [];
                const hasBraveKey = !!process.env.BRAVE_API_KEY;
                if (hasBraveKey) {
                    providers.push(() => searchBrave(args.query));
                }
                providers.push(() => searchDuckDuckGo(args.query));
                for (const provider of providers) {
                    try {
                        const results = await provider();
                        if (results.length > 0) {
                            searchCache.set(args.query, { results, ts: Date.now() });
                            return JSON.stringify({ results });
                        }
                    }
                    catch (err) {
                        console.log(`Search provider failed: ${err instanceof Error ? err.message : err}`);
                    }
                }
                if (!hasBraveKey) {
                    return JSON.stringify({
                        error: 'Web search is unavailable. Brave Search API key is not configured. '
                            + 'Ask the user to provide a Brave Search API key (free at https://brave.com/search/api/). '
                            + 'Once they give it, use save_credential with name BRAVE_API_KEY to store it. '
                            + 'Do NOT retry the search until the key is saved.',
                    });
                }
                return JSON.stringify({
                    error: 'Web search is temporarily unavailable (all providers failed). '
                        + 'Do NOT retry the search — tell the user that search is currently down and offer to help without it.',
                });
            },
        }),
        web_fetch: tool({
            description: 'Fetch a web page and return its text content (HTML tags stripped). '
                + 'Use this to read documentation, articles, or any web page after finding URLs via web_search.',
            inputSchema: z.object({
                url: z.string().describe('URL to fetch'),
            }),
            execute: async (args) => {
                try {
                    const resp = await fetch(args.url, {
                        headers: { 'User-Agent': USER_AGENT },
                        signal: AbortSignal.timeout(15000),
                        redirect: 'follow',
                    });
                    if (!resp.ok)
                        return JSON.stringify({ error: `HTTP ${resp.status}` });
                    const contentType = resp.headers.get('content-type') || '';
                    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
                        return JSON.stringify({ error: `Unsupported content type: ${contentType}` });
                    }
                    const body = await resp.text();
                    const text = stripHtml(body).slice(0, 8000);
                    return JSON.stringify({ url: args.url, content: text });
                }
                catch (err) {
                    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
                }
            },
        }),
    };
}
// === Resource Tools ===
function createResourceTools() {
    return {
        get_system_resources: tool({
            description: 'Get current system resource usage (CPU, RAM, disk). Use when the user asks about system status, performance, or resources.',
            inputSchema: z.object({}),
            execute: async () => {
                const { getResourceSnapshot } = await import('../monitor/resources.js');
                const snapshot = await getResourceSnapshot();
                return JSON.stringify(snapshot);
            },
        }),
        check_installation_feasibility: tool({
            description: 'Check if the system has enough disk space and RAM for an installation (e.g. AI model, software package)',
            inputSchema: z.object({
                required_disk_gb: z.number().describe('Required free disk space in GB'),
                required_ram_gb: z.number().describe('Required free RAM in GB'),
            }),
            execute: async (args) => {
                const { checkInstallationFeasibility } = await import('../monitor/resources.js');
                const result = checkInstallationFeasibility(args.required_disk_gb, args.required_ram_gb);
                return JSON.stringify(result);
            },
        }),
    };
}
// === Shell Tools ===
function createShellTools() {
    return {
        run_shell_command: tool({
            description: 'Execute a shell command on the server and return its output. '
                + 'Use this to install packages, manage files, run scripts, check system state, etc. '
                + 'Commands run as the current process user with a 60-second timeout.',
            inputSchema: z.object({
                command: z.string().describe('The shell command to execute (e.g. "apt-get install -y ffmpeg", "ls -la /data")'),
            }),
            execute: async (args) => {
                const { exec } = await import('node:child_process');
                const { promisify } = await import('node:util');
                const execAsync = promisify(exec);
                try {
                    const { stdout, stderr } = await execAsync(args.command, {
                        timeout: 60_000,
                        maxBuffer: 1024 * 1024,
                        env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
                    });
                    const output = (stdout || '').trim();
                    const errors = (stderr || '').trim();
                    return JSON.stringify({
                        success: true,
                        ...(output ? { stdout: output.slice(0, 10_000) } : {}),
                        ...(errors ? { stderr: errors.slice(0, 5_000) } : {}),
                    });
                }
                catch (err) {
                    const e = err;
                    return JSON.stringify({
                        success: false,
                        exit_code: e.code,
                        stdout: (e.stdout || '').trim().slice(0, 5_000) || undefined,
                        stderr: (e.stderr || '').trim().slice(0, 5_000) || undefined,
                        error: e.message?.slice(0, 1_000),
                    });
                }
            },
        }),
        read_file: tool({
            description: 'Read the contents of a file on the server.',
            inputSchema: z.object({
                path: z.string().describe('Absolute path to the file'),
            }),
            execute: async (args) => {
                try {
                    const content = readFileSync(args.path, 'utf-8');
                    return JSON.stringify({
                        success: true,
                        content: content.slice(0, 50_000),
                        truncated: content.length > 50_000,
                    });
                }
                catch (err) {
                    return JSON.stringify({ success: false, error: err.message });
                }
            },
        }),
        write_file: tool({
            description: 'Write content to a file on the server. Creates parent directories if needed.',
            inputSchema: z.object({
                path: z.string().describe('Absolute path to the file'),
                content: z.string().describe('Content to write'),
            }),
            execute: async (args) => {
                try {
                    const { mkdirSync } = await import('node:fs');
                    const { dirname } = await import('node:path');
                    mkdirSync(dirname(args.path), { recursive: true });
                    writeFileSync(args.path, args.content);
                    return JSON.stringify({ success: true, path: args.path });
                }
                catch (err) {
                    return JSON.stringify({ success: false, error: err.message });
                }
            },
        }),
    };
}
// === History Tools ===
function createHistoryTools(messageRepo, configManager) {
    return {
        get_recent_messages: tool({
            description: 'Get recent messages from the current conversation for additional context. '
                + 'You only see the last 2 exchanges by default. Call this when the user references '
                + 'something from earlier ("as I said", "continue", "what about X we discussed").',
            inputSchema: z.object({
                count: z.number().optional().describe('Number of messages to retrieve (default 20, max 50)'),
            }),
            execute: async (args) => {
                const chatId = configManager.getChatId();
                if (!chatId)
                    return JSON.stringify({ error: 'No active chat' });
                const count = Math.min(args.count ?? 20, 50);
                const messages = messageRepo.getRecent(chatId, count);
                return JSON.stringify({
                    messages: messages.map((m) => ({
                        role: m.role,
                        text: m.text.length > 500 ? m.text.slice(0, 500) + '...' : m.text,
                        date: m.created_at,
                    })),
                });
            },
        }),
        search_conversation_history: tool({
            description: 'Search through past conversation history. Use this when the user asks about previous conversations, '
                + 'e.g. "what did I ask about last week?", "find our conversation about X", "what did you recommend for Y?"',
            inputSchema: z.object({
                query: z.string().describe('Search text to find in past messages'),
                limit: z.number().optional().describe('Max results to return (default 10)'),
            }),
            execute: async (args) => {
                const results = messageRepo.searchAll(args.query, args.limit || 10);
                if (results.length === 0)
                    return JSON.stringify({ found: 0, message: 'No messages found matching the query.' });
                const formatted = results.map((m) => ({
                    role: m.role,
                    text: m.text.length > 300 ? m.text.slice(0, 300) + '...' : m.text,
                    date: m.created_at,
                }));
                return JSON.stringify({ found: results.length, messages: formatted });
            },
        }),
        get_conversation_stats: tool({
            description: 'Get statistics about conversation history: total messages, date range, etc. '
                + 'Use when user asks "how many messages have we exchanged?", "when did we first talk?", etc.',
            inputSchema: z.object({
                chat_id: z.number().optional().describe('Chat ID (omit for overall stats)'),
            }),
            execute: async (args) => {
                if (args.chat_id)
                    return JSON.stringify(messageRepo.getStats(args.chat_id));
                const disk = messageRepo.getDiskUsage();
                return JSON.stringify({ ...disk, note: 'Provide chat_id for per-chat stats' });
            },
        }),
    };
}
// === Usage Tools ===
function createUsageTools(usageRepo) {
    return {
        get_api_usage: tool({
            description: 'Get API token usage statistics (today and this month). Use when user asks about costs, spending, tokens, usage, how much they\'ve used, etc.',
            inputSchema: z.object({
                period: z.enum(['today', 'month']).optional().describe('Period to query (default: both)'),
            }),
            execute: async (args) => {
                const today = usageRepo.getToday();
                const month = usageRepo.getMonth();
                if (args.period === 'today')
                    return JSON.stringify({ period: 'today', ...today });
                if (args.period === 'month')
                    return JSON.stringify({ period: 'month', ...month });
                return JSON.stringify({ today, month });
            },
        }),
    };
}
// === Profile Tool ===
function createProfileTools(configManager) {
    return {
        save_user_profile: tool({
            description: 'Save user profile information (name, city, birthday). Call this when the user tells you their name, city, or birthday during the initial conversation. '
                + 'You can call this multiple times — each call merges new fields with the existing profile.',
            inputSchema: z.object({
                name: z.string().optional().describe('User\'s preferred name'),
                city: z.string().optional().describe('User\'s city of residence'),
                birthday: z.string().optional().describe('User\'s birthday in MM-DD format (e.g. "03-15" for March 15)'),
            }),
            execute: async (args) => {
                const profile = {};
                if (args.name)
                    profile.name = args.name;
                if (args.birthday)
                    profile.birthday = args.birthday;
                if (args.city) {
                    profile.city = args.city;
                    // Resolve timezone from city name
                    try {
                        const resp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args.city)}&count=1&language=en`);
                        if (resp.ok) {
                            const data = await resp.json();
                            if (data.results?.length) {
                                profile.city = data.results[0].name;
                                profile.timezone = data.results[0].timezone;
                                configManager.updateTimezone(data.results[0].timezone);
                            }
                        }
                    }
                    catch { /* timezone resolution is best-effort */ }
                }
                if (Object.keys(profile).length > 0) {
                    configManager.updateProfile(profile);
                }
                return JSON.stringify({ success: true, saved: profile });
            },
        }),
    };
}
// === Memory Tools ===
const MEMORY_MAX_CHARS = 4000;
function createMemoryTools(memoryDir) {
    const memoryFile = join(memoryDir, 'MEMORY.md');
    return {
        save_memory: tool({
            description: 'Save persistent memory that will be available across all future conversations. '
                + 'This REPLACES the entire memory file — include ALL content you want to keep. '
                + 'Use this when the user shares important personal info, preferences, or context worth remembering long-term.',
            inputSchema: z.object({
                content: z.string().describe('Full markdown content to save as memory (max ~4000 chars)'),
            }),
            execute: async (args) => {
                try {
                    let content = args.content;
                    if (content.length > MEMORY_MAX_CHARS) {
                        content = content.slice(0, MEMORY_MAX_CHARS);
                    }
                    mkdirSync(memoryDir, { recursive: true });
                    writeFileSync(memoryFile, content, 'utf-8');
                    return JSON.stringify({
                        success: true,
                        chars: content.length,
                        truncated: args.content.length > MEMORY_MAX_CHARS,
                    });
                }
                catch (err) {
                    return JSON.stringify({ success: false, error: err.message });
                }
            },
        }),
    };
}
// === Credential Tool ===
function createCredentialTools() {
    return {
        save_credential: tool({
            description: 'Save a user-provided credential (API key, token, login, password) so it can be used by skills. '
                + 'The credential is stored securely and available immediately. '
                + 'Use SCREAMING_SNAKE_CASE for the name (e.g. FREEDOM_FINANCE_API_KEY).',
            inputSchema: z.object({
                name: z.string().describe('Environment variable name in SCREAMING_SNAKE_CASE (e.g. FREEDOM_FINANCE_API_KEY)'),
                value: z.string().describe('The credential value to save'),
            }),
            execute: async (args) => {
                const { name, value } = args;
                if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
                    return JSON.stringify({ error: 'Invalid name. Use SCREAMING_SNAKE_CASE (e.g. MY_API_KEY)' });
                }
                process.env[name] = value;
                try {
                    let lines = [];
                    if (existsSync(ENV_FILE)) {
                        lines = readFileSync(ENV_FILE, 'utf-8').split('\n');
                    }
                    const prefix = `${name}=`;
                    const existingIdx = lines.findIndex((l) => l.startsWith(prefix));
                    if (existingIdx !== -1) {
                        lines[existingIdx] = `${name}=${value}`;
                    }
                    else {
                        while (lines.length > 0 && lines[lines.length - 1].trim() === '')
                            lines.pop();
                        lines.push(`${name}=${value}`);
                    }
                    writeFileSync(ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 });
                    return JSON.stringify({
                        success: true, name,
                        message: `Credential ${name} saved and available immediately.`,
                    });
                }
                catch (err) {
                    return JSON.stringify({
                        success: true, name,
                        message: `Credential ${name} set for this session (file save failed: ${err}).`,
                    });
                }
            },
        }),
    };
}
// === Execute Dynamic Skill Tool ===
function createExecuteSkillTools(skillsDir) {
    return {
        execute_dynamic_skill: tool({
            description: 'Execute a dynamically created skill tool by name. Use this to call skills that were just created by evolve_skill, '
                + 'or to retry a failed skill call. This loads the latest version of the skill from disk.',
            inputSchema: z.object({
                tool_name: z.string().describe('Name of the tool to execute (e.g. "get_freedom_finance_positions")'),
                args: z.record(z.string(), z.unknown()).optional().describe('Arguments to pass to the tool (key-value pairs)'),
            }),
            execute: async (input) => {
                if (!existsSync(skillsDir)) {
                    return JSON.stringify({ error: 'No skills directory found' });
                }
                const files = readdirSync(skillsDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
                for (const file of files) {
                    try {
                        const fullPath = join(skillsDir, file);
                        const mod = await import(pathToFileURL(fullPath).href + `?t=${Date.now()}`);
                        const toolsMap = mod.tools;
                        if (toolsMap && typeof toolsMap === 'object') {
                            const found = toolsMap[input.tool_name];
                            if (found && typeof found.execute === 'function') {
                                const result = await found.execute(input.args || {});
                                return typeof result === 'string' ? result : JSON.stringify(result);
                            }
                        }
                    }
                    catch (err) {
                        console.error(`execute_dynamic_skill: error loading ${file}:`, err instanceof Error ? err.message : err);
                        continue;
                    }
                }
                // Not found — list available
                const available = [];
                for (const file of files) {
                    try {
                        const fullPath = join(skillsDir, file);
                        const mod = await import(pathToFileURL(fullPath).href + `?t=${Date.now()}`);
                        if (mod.tools && typeof mod.tools === 'object') {
                            available.push(...Object.keys(mod.tools));
                        }
                    }
                    catch { /* skip broken files */ }
                }
                return JSON.stringify({ error: `Tool "${input.tool_name}" not found`, available_tools: available });
            },
        }),
    };
}
//# sourceMappingURL=tools.js.map