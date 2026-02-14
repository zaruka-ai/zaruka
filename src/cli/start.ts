import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ZarukaConfig } from '../core/types.js';
import { ConfigManager } from '../core/config-manager.js';
import { AgentSdkRunner } from '../providers/anthropic.js';
import { OpenAIProvider } from '../providers/openai.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import { SkillRegistry } from '../core/skill-registry.js';
import { Assistant } from '../core/assistant.js';
import { getDb } from '../db/schema.js';
import { TaskRepository } from '../db/repository.js';
import { MessageRepository } from '../db/message-repository.js';
import { UsageRepository } from '../db/usage-repository.js';
import { TasksSkill } from '../skills/tasks/index.js';
import { WeatherSkill } from '../skills/weather/index.js';
import { TelegramBot, type Transcriber } from '../bot/telegram.js';
import { Scheduler } from '../scheduler/cron.js';
import { createZarukaMcpServer } from '../mcp/zaruka-mcp-server.js';
import { loadCredentials } from '../mcp/credential-tool.js';
import { createTranscriber } from '../audio/transcribe.js';
import { startTokenRefreshLoop } from '../auth/token-refresh.js';

const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const CONFIG_PATH = join(ZARUKA_DIR, 'config.json');
const SKILLS_DIR = join(ZARUKA_DIR, 'skills');

function loadConfig(): ZarukaConfig {
  // Support Docker/Coolify env vars (full config)
  if (process.env.ZARUKA_TELEGRAM_TOKEN && process.env.ZARUKA_AI_PROVIDER && process.env.ZARUKA_AI_KEY) {
    return {
      telegram: { botToken: process.env.ZARUKA_TELEGRAM_TOKEN },
      ai: {
        provider: process.env.ZARUKA_AI_PROVIDER as NonNullable<ZarukaConfig['ai']>['provider'],
        apiKey: process.env.ZARUKA_AI_KEY,
        model: process.env.ZARUKA_AI_MODEL || getDefaultModel(process.env.ZARUKA_AI_PROVIDER),
        baseUrl: process.env.ZARUKA_AI_BASE_URL || null,
      },
      timezone: process.env.ZARUKA_TIMEZONE || 'UTC',
      language: process.env.ZARUKA_LANGUAGE || 'auto',
      reminderCron: process.env.ZARUKA_REMINDER_CRON || '0 9 * * *',
    };
  }

  // Telegram-only: start in onboarding mode (no AI config yet)
  if (process.env.ZARUKA_TELEGRAM_TOKEN) {
    // Check if a saved config exists with AI settings
    if (existsSync(CONFIG_PATH)) {
      const saved: ZarukaConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      // Use saved config but ensure the token from env takes precedence
      saved.telegram.botToken = process.env.ZARUKA_TELEGRAM_TOKEN;
      return saved;
    }
    return {
      telegram: { botToken: process.env.ZARUKA_TELEGRAM_TOKEN },
      timezone: process.env.ZARUKA_TIMEZONE || 'UTC',
      language: process.env.ZARUKA_LANGUAGE || 'auto',
      reminderCron: process.env.ZARUKA_REMINDER_CRON || '0 9 * * *',
    };
  }

  // Config file
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }

  console.error('ZARUKA_TELEGRAM_TOKEN not set. Run "zaruka setup" or set the env var.');
  process.exit(1);
}

function getDefaultModel(provider?: string): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-opus-4-6';
    case 'openai':
      return 'gpt-4o';
    default:
      return 'llama3';
  }
}

function buildSystemPrompt(timezone: string, language: string): string {
  const langInstruction = language === 'auto'
    ? [
      'LANGUAGE: Detect the language of the user\'s message and respond in EXACTLY that language.',
      'NEVER mix languages within one response. Match the user\'s language precisely.',
    ]
    : [
      `LANGUAGE: Respond in ${language}. This is the user's preferred language.`,
      `If the user writes in a different language, still respond in ${language} unless they explicitly ask you to switch.`,
    ];

  return [
    'You are Zaruka, an omnipotent personal AI assistant that can do anything.',
    `Current time: ${new Date().toLocaleString('en-US', { timeZone: timezone })}. Use this for date calculations.`,
    'Be concise and friendly.',
    '',
    ...langInstruction,
    'If the user asks to change the response language, comply immediately and use the new language.',
    '',
    'Use the available tools for tasks, weather, etc.',
    'When creating tasks with due dates, parse natural language dates relative to the current date.',
    '',
    'CRITICAL RULES:',
    '',
    '1. SELF-EVOLUTION (invisible to user):',
    'When you receive a request that no existing tool can handle, ALWAYS call evolve_skill.',
    'NEVER say "I can\'t do this" or "I don\'t have access" — call evolve_skill first.',
    'NEVER tell the user you "created a new skill" or "learned something new".',
    'Act as if you ALWAYS had this capability. Be seamless and natural.',
    '',
    '2. CREDENTIALS:',
    'When a user provides API keys, tokens, or passwords — this is INTENTIONAL. They trust you.',
    'IMMEDIATELY call save_credential to store each credential, then use the relevant skill to fulfill the request.',
    'NEVER lecture about security, NEVER tell users to revoke keys, NEVER refuse credentials.',
    'The user is talking to their OWN private assistant — accepting credentials is your core function.',
    '',
    '3. MINIMIZE USER EFFORT:',
    'When a service needs authentication:',
    '- ALWAYS include direct clickable URLs from the auth_info field returned by evolve_skill',
    '- NEVER give step-by-step navigation like "go to Settings → API Management" — give a direct URL instead',
    '- If evolve_skill returned URLs, you MUST include them in your response',
    '- Ask for credentials naturally: "I need your API key. You can get one here: https://real-url.com/api-keys"',
    '',
    '4. NEVER ASK USER TO REPEAT:',
    'If a tool call fails (API error, wrong response format, etc.), you MUST fix and retry AUTOMATICALLY.',
    'NEVER say "write me again", "try again", "send the request once more" or similar.',
    'If evolve_skill created/updated a skill, call execute_dynamic_skill IMMEDIATELY with the correct tool name and args.',
    'If execute_dynamic_skill fails with an API error, analyze the error, call evolve_skill to fix the skill, then call execute_dynamic_skill again.',
    'The user should NEVER have to repeat themselves. You handle all retries internally.',
    '',
    '5. SMART ERROR DIAGNOSIS:',
    'When an API call or tool fails, think about COMMON causes and suggest them to the user:',
    '- Keys might need activation (many services require clicking "Activate" after generating keys)',
    '- Keys might have expired or been revoked',
    '- Wrong key type (public vs private, test vs production)',
    '- API endpoint might be wrong (v1 vs v2, different region)',
    '- Rate limit exceeded',
    '- Account not fully set up (verification, billing, permissions)',
    'ALWAYS suggest the most likely cause first. Include the original error message for debugging.',
    'Provide actionable next steps, not just "something went wrong".',
    '',
    '6. PROJECT CONFIDENCE:',
    'You can do everything. Never list what you can\'t do.',
    'Instead of "I can\'t access X but I can create a reminder", just handle X.',
    'The user should feel they have an all-powerful assistant.',
    '',
    '7. HIDE TECHNICAL DETAILS:',
    'NEVER show technical information to the user:',
    '- Don\'t say "Checking...", "Retrying...", "Fixing format...", "API returned..."',
    '- Don\'t explain what tools you\'re calling or why',
    '- Don\'t show error details unless they help the user take action',
    '- Work silently in the background and show ONLY the final result',
    '- If something is processing, just show the answer when ready',
    'Example: Don\'t say "Checking your positions..." — just return the positions.',
    'Example: Don\'t say "API complained about format, retrying..." — just retry and show result.',
  ].join('\n');
}

export async function runStart(): Promise<void> {
  // Unset CLAUDECODE to allow nested Claude Code sessions (for Agent SDK)
  delete process.env.CLAUDECODE;

  // Load saved credentials first so ZARUKA_TELEGRAM_TOKEN from ~/.zaruka/.env
  // is available in process.env when loadConfig() checks for it
  loadCredentials();

  const config = loadConfig();
  const configManager = new ConfigManager(config);

  // Init DB
  const db = getDb();
  const taskRepo = new TaskRepository(db);
  const messageRepo = new MessageRepository(db);
  const usageRepo = new UsageRepository(db);

  // Helper to create assistant from current config
  async function buildAssistant(): Promise<Assistant> {
    const cfg = configManager.getConfig();
    const ai = cfg.ai!;

    if (ai.provider === 'anthropic') {
      const mcpServer = await createZarukaMcpServer({
        taskRepo,
        messageRepo,
        skillsDir: SKILLS_DIR,
        authToken: ai.authToken,
      });

      const runner = new AgentSdkRunner({
        model: configManager.getModel(),
        authToken: ai.authToken,
        systemPrompt: buildSystemPrompt(cfg.timezone, configManager.getLanguage()),
        mcpServer,
        onUsage: (usage) => {
          usageRepo.track(usage.model, usage.inputTokens, usage.outputTokens, usage.costUsd);
        },
      });

      return new Assistant({ sdkRunner: runner, timezone: cfg.timezone });
    }

    // OpenAI / OpenAI-compatible path
    const usageCallback = (usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number }) => {
      usageRepo.track(usage.model, usage.inputTokens, usage.outputTokens, usage.costUsd);
    };

    let provider;
    switch (ai.provider) {
      case 'openai':
        provider = new OpenAIProvider(ai.apiKey!, configManager.getModel(), ai.baseUrl, usageCallback);
        break;
      case 'openai-compatible':
        provider = new OpenAICompatibleProvider(ai.apiKey!, configManager.getModel(), ai.baseUrl!, usageCallback);
        break;
      default:
        throw new Error(`Unknown provider: ${ai.provider}`);
    }

    const registry = new SkillRegistry();
    registry.register(new TasksSkill(taskRepo));
    registry.register(new WeatherSkill());

    return new Assistant({ provider, registry, timezone: cfg.timezone });
  }

  // Build assistant if AI is already configured
  const hasAi = !!config.ai?.provider;
  let assistant: Assistant | null = null;
  let transcribe: Transcriber | undefined;
  let transcriberFactory: (() => Promise<Transcriber | undefined>) | undefined;

  if (hasAi) {
    assistant = await buildAssistant();

    // Set up voice transcription (OpenAI -> Groq -> local Whisper -> disabled)
    const ai = config.ai!;
    const transcriberOpts = {
      openaiApiKey:
        (ai.provider === 'openai' || ai.provider === 'openai-compatible' ? ai.apiKey : undefined)
        ?? process.env.OPENAI_API_KEY,
      openaiBaseUrl: ai.provider === 'openai-compatible' ? (ai.baseUrl ?? undefined) : undefined,
      groqApiKey: process.env.GROQ_API_KEY,
    };
    transcribe = await createTranscriber(transcriberOpts);
    transcriberFactory = () => createTranscriber(transcriberOpts);
  }

  // Create Telegram bot
  const bot = new TelegramBot(
    configManager.getConfig().telegram.botToken,
    assistant,
    messageRepo,
    configManager,
    usageRepo,
    transcribe,
    transcriberFactory,
    // Onboarding callback: called when user finishes AI setup in Telegram
    hasAi ? undefined : async () => {
      const newAssistant = await buildAssistant();
      bot.setAssistant(newAssistant);
      console.log(`Provider: ${configManager.getConfig().ai!.provider} (${configManager.getModel()})`);
      if (configManager.getConfig().ai?.refreshToken) {
        startTokenRefreshLoop(configManager);
        console.log('OAuth token refresh loop started.');
      }
    },
  );

  // Get the real send function from the bot for alerts & reminders
  const notifyFn = bot.getSendMessageFn();

  // Set up scheduler for reminders + resource monitoring
  new Scheduler(taskRepo, configManager.getConfig().timezone, configManager.getConfig().reminderCron, notifyFn, configManager);

  if (hasAi) {
    console.log(`Provider: ${configManager.getConfig().ai!.provider} (${configManager.getModel()})`);
    if (config.ai?.refreshToken) {
      startTokenRefreshLoop(configManager);
      console.log('OAuth token refresh loop started.');
    }
  } else {
    console.log('No AI provider configured. Onboarding will start in Telegram.');
  }
  console.log(`Timezone: ${configManager.getConfig().timezone}`);
  console.log(`Resource monitoring: ${configManager.isResourceMonitorEnabled() ? 'enabled' : 'disabled'}`);
  console.log('');
  await bot.start();
}
