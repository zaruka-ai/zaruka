import { z } from 'zod/v4';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { TaskRepository } from '../db/repository.js';
import type { UsageRepository } from '../db/usage-repository.js';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
}

async function geocode(location: string): Promise<GeoResult | null> {
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(location)}&count=1&language=en`;
  const res = await fetch(url);
  const data = (await res.json()) as { results?: GeoResult[] };
  return data.results?.[0] ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTaskTools(repo: TaskRepository): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      'create_task',
      'Create a new task',
      {
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description'),
        due_date: z.string().optional().describe('Due date in YYYY-MM-DD format'),
      },
      async (args) => {
        const task = repo.create({
          title: args.title,
          description: args.description,
          due_date: args.due_date,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                task: { id: task.id, title: task.title, due_date: task.due_date },
              }),
            },
          ],
        };
      },
    ),
    tool(
      'list_tasks',
      'List tasks, optionally filtered by status',
      {
        status: z.enum(['active', 'completed']).optional().describe('Filter by status (default: all non-deleted)'),
      },
      async (args) => {
        const tasks = repo.list(args.status);
        const result =
          tasks.length === 0
            ? { tasks: [], message: 'No tasks found' }
            : {
                tasks: tasks.map((t) => ({
                  id: t.id,
                  title: t.title,
                  due_date: t.due_date,
                  status: t.status,
                })),
              };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      },
    ),
    tool(
      'complete_task',
      'Mark a task as completed',
      { id: z.number().describe('Task ID') },
      async (args) => {
        const task = repo.complete(args.id);
        const result = task
          ? { success: true, task: { id: task.id, title: task.title, status: task.status } }
          : { success: false, error: 'Task not found' };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      },
    ),
    tool(
      'delete_task',
      'Delete a task',
      { id: z.number().describe('Task ID') },
      async (args) => {
        const ok = repo.delete(args.id);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: ok }) }] };
      },
    ),
    tool(
      'update_task',
      'Update a task',
      {
        id: z.number().describe('Task ID'),
        title: z.string().optional().describe('New title'),
        description: z.string().optional().describe('New description'),
        due_date: z.string().optional().describe('New due date in YYYY-MM-DD format'),
      },
      async (args) => {
        const { id, ...rest } = args;
        const task = repo.update(id, rest as { title?: string; description?: string; due_date?: string });
        const result = task
          ? { success: true, task: { id: task.id, title: task.title, due_date: task.due_date } }
          : { success: false, error: 'Task not found' };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      },
    ),
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createResourceTools(): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      'get_system_resources',
      'Get current system resource usage (CPU, RAM, disk). Use when the user asks about system status, performance, or resources.',
      {},
      async () => {
        const { getResourceSnapshot } = await import('../monitor/resources.js');
        const snapshot = await getResourceSnapshot();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(snapshot) }],
        };
      },
    ),
    tool(
      'check_installation_feasibility',
      'Check if the system has enough disk space and RAM for an installation (e.g. AI model, software package)',
      {
        required_disk_gb: z.number().describe('Required free disk space in GB'),
        required_ram_gb: z.number().describe('Required free RAM in GB'),
      },
      async (args) => {
        const { checkInstallationFeasibility } = await import('../monitor/resources.js');
        const result = checkInstallationFeasibility(args.required_disk_gb, args.required_ram_gb);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      },
    ),
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createUsageTools(usageRepo: UsageRepository): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      'get_api_usage',
      'Get API token usage statistics (today and this month). Use when user asks about costs, spending, tokens, usage, how much they\'ve used, etc.',
      {
        period: z.enum(['today', 'month']).optional().describe('Period to query (default: both)'),
      },
      async (args) => {
        const today = usageRepo.getToday();
        const month = usageRepo.getMonth();

        if (args.period === 'today') {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ period: 'today', ...today }) }] };
        }
        if (args.period === 'month') {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ period: 'month', ...month }) }] };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ today, month }),
          }],
        };
      },
    ),
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWeatherTools(): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      'get_weather',
      'Get weather forecast for a location',
      {
        location: z.string().describe('City or place name'),
        date: z.string().optional().describe('Date in YYYY-MM-DD format (optional, default: today)'),
      },
      async (args) => {
        const geo = await geocode(args.location);
        if (!geo) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Location "${args.location}" not found` }) }],
          };
        }

        const params = new URLSearchParams({
          latitude: String(geo.latitude),
          longitude: String(geo.longitude),
          daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weathercode',
          current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weathercode',
          timezone: 'auto',
          forecast_days: '7',
        });

        const res = await fetch(`${WEATHER_URL}?${params}`);
        const data = (await res.json()) as Record<string, unknown>;

        if (args.date) {
          const daily = data.daily as Record<string, unknown[]>;
          const idx = (daily.time as string[]).indexOf(args.date);
          if (idx >= 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    location: `${geo.name}, ${geo.country}`,
                    date: args.date,
                    temperature_max: (daily.temperature_2m_max as number[])[idx],
                    temperature_min: (daily.temperature_2m_min as number[])[idx],
                    precipitation_mm: (daily.precipitation_sum as number[])[idx],
                    wind_speed_max_kmh: (daily.wind_speed_10m_max as number[])[idx],
                  }),
                },
              ],
            };
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                location: `${geo.name}, ${geo.country}`,
                current: data.current,
                daily_forecast: data.daily,
              }),
            },
          ],
        };
      },
    ),
    tool(
      'get_marine_conditions',
      'Get marine/ocean conditions (wave height, period, direction) for a coastal location',
      {
        location: z.string().describe('Coastal city or place name'),
        date: z.string().optional().describe('Date in YYYY-MM-DD format (optional, default: today)'),
      },
      async (args) => {
        const geo = await geocode(args.location);
        if (!geo) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Location "${args.location}" not found` }) }],
          };
        }

        const params = new URLSearchParams({
          latitude: String(geo.latitude),
          longitude: String(geo.longitude),
          daily: 'wave_height_max,wave_period_max,wave_direction_dominant',
          timezone: 'auto',
          forecast_days: '7',
        });

        const res = await fetch(`${MARINE_URL}?${params}`);
        const data = (await res.json()) as Record<string, unknown>;

        if (args.date) {
          const daily = data.daily as Record<string, unknown[]>;
          const idx = (daily.time as string[]).indexOf(args.date);
          if (idx >= 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    location: `${geo.name}, ${geo.country}`,
                    date: args.date,
                    wave_height_max_m: (daily.wave_height_max as number[])[idx],
                    wave_period_max_s: (daily.wave_period_max as number[])[idx],
                    wave_direction: (daily.wave_direction_dominant as number[])[idx],
                  }),
                },
              ],
            };
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                location: `${geo.name}, ${geo.country}`,
                marine_forecast: data.daily,
              }),
            },
          ],
        };
      },
    ),
  ];
}
