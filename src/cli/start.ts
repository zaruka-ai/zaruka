import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ZarukaConfig } from '../core/types.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { OpenAIProvider } from '../providers/openai.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import { SkillRegistry } from '../core/skill-registry.js';
import { Assistant } from '../core/assistant.js';
import { getDb } from '../db/schema.js';
import { TaskRepository } from '../db/repository.js';
import { TasksSkill } from '../skills/tasks/index.js';
import { WeatherSkill } from '../skills/weather/index.js';
import { TelegramBot } from '../bot/telegram.js';
import { Scheduler } from '../scheduler/cron.js';

const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const CONFIG_PATH = join(ZARUKA_DIR, 'config.json');

function loadConfig(): ZarukaConfig {
  // Support Docker/Coolify env vars
  if (process.env.ZARUKA_TELEGRAM_TOKEN && process.env.ZARUKA_AI_PROVIDER && process.env.ZARUKA_AI_KEY) {
    return {
      telegram: { botToken: process.env.ZARUKA_TELEGRAM_TOKEN },
      ai: {
        provider: process.env.ZARUKA_AI_PROVIDER as ZarukaConfig['ai']['provider'],
        apiKey: process.env.ZARUKA_AI_KEY,
        model: process.env.ZARUKA_AI_MODEL || getDefaultModel(process.env.ZARUKA_AI_PROVIDER),
        baseUrl: process.env.ZARUKA_AI_BASE_URL || null,
      },
      timezone: process.env.ZARUKA_TIMEZONE || 'UTC',
      reminderCron: process.env.ZARUKA_REMINDER_CRON || '0 9 * * *',
    };
  }

  if (!existsSync(CONFIG_PATH)) {
    console.error('Config not found. Run "zaruka setup" first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

function getDefaultModel(provider?: string): string {
  switch (provider) {
    case 'anthropic': return 'claude-haiku-4-5-20251001';
    case 'openai': return 'gpt-4o';
    default: return 'llama3';
  }
}

export async function runStart(): Promise<void> {
  const config = loadConfig();

  // Create LLM provider
  let provider;
  switch (config.ai.provider) {
    case 'anthropic':
      provider = new AnthropicProvider(config.ai.model, config.ai.authToken);
      break;
    case 'openai':
      provider = new OpenAIProvider(config.ai.apiKey!, config.ai.model, config.ai.baseUrl);
      break;
    case 'openai-compatible':
      provider = new OpenAICompatibleProvider(config.ai.apiKey!, config.ai.model, config.ai.baseUrl!);
      break;
    default:
      console.error(`Unknown provider: ${config.ai.provider}`);
      process.exit(1);
  }

  // Init DB
  const db = getDb();
  const taskRepo = new TaskRepository(db);

  // Register skills
  const registry = new SkillRegistry();
  registry.register(new TasksSkill(taskRepo));
  registry.register(new WeatherSkill());

  // Create assistant
  const assistant = new Assistant(provider, registry, config.timezone);

  // Create and start Telegram bot
  const bot = new TelegramBot(config.telegram.botToken, assistant);

  // Set up scheduler for reminders
  new Scheduler(taskRepo, config.timezone, config.reminderCron, async (message) => {
    // Send reminder to all recent chat users
    // For simplicity, we log it. In production, store chat IDs.
    console.log('Reminder:', message);
  });

  console.log(`Provider: ${config.ai.provider} (${config.ai.model})`);
  console.log(`Timezone: ${config.timezone}`);
  console.log('');
  await bot.start();
}
