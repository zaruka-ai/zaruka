import { input, select } from '@inquirer/prompts';
import { writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ZarukaConfig } from '../core/types.js';

const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const CONFIG_PATH = join(ZARUKA_DIR, 'config.json');

export async function runSetup(): Promise<void> {
  console.log('\n  Zaruka — Setup\n');
  console.log('  Let\'s set up your assistant!\n');

  // Step 1: Telegram Bot Token
  console.log('  1/4 Telegram Bot Token');
  console.log('  ' + '─'.repeat(21));
  console.log('  Create a bot via @BotFather in Telegram and paste the token.');
  console.log('  Guide: https://core.telegram.org/bots#botfather\n');

  const botToken = await input({
    message: 'Token:',
    validate: (val) => val.trim().length > 10 || 'Please enter a valid bot token',
  });

  // Validate bot token by calling Telegram API
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken.trim()}/getMe`);
    const data = await res.json() as { ok: boolean; result?: { username: string } };
    if (data.ok && data.result) {
      console.log(`  ✓ Bot connected: @${data.result.username}\n`);
    } else {
      console.log('  ⚠ Could not verify bot token, but continuing...\n');
    }
  } catch {
    console.log('  ⚠ Could not reach Telegram API, but continuing...\n');
  }

  // Step 2: AI Provider
  console.log('  2/4 AI Provider');
  console.log('  ' + '─'.repeat(15));

  const provider = await select({
    message: 'Which AI provider would you like to use?',
    choices: [
      { name: 'Anthropic Claude (recommended)', value: 'anthropic' as const },
      { name: 'OpenAI (GPT-4, Codex)', value: 'openai' as const },
      { name: 'Other OpenAI-compatible API', value: 'openai-compatible' as const },
    ],
  });

  // Step 3: API Key & model
  console.log('\n  3/4 API Key');
  console.log('  ' + '─'.repeat(11));

  let apiKeyHint = '';
  let defaultModel = '';
  if (provider === 'anthropic') {
    apiKeyHint = 'Get your key at console.anthropic.com';
    defaultModel = 'claude-haiku-4-5-20251001';
  } else if (provider === 'openai') {
    apiKeyHint = 'Get your key at platform.openai.com';
    defaultModel = 'gpt-4o';
  } else {
    apiKeyHint = 'Enter the API key for your provider';
    defaultModel = 'llama3';
  }
  console.log(`  ${apiKeyHint}\n`);

  const apiKey = await input({
    message: 'API Key:',
    validate: (val) => val.trim().length > 0 || 'API key is required',
  });

  const model = await input({
    message: 'Model:',
    default: defaultModel,
  });

  let baseUrl: string | null = null;
  if (provider === 'openai-compatible') {
    baseUrl = await input({
      message: 'Base URL:',
      default: 'http://localhost:11434/v1',
    });
  }

  console.log('  ✓ Key saved\n');

  // Step 4: Timezone
  console.log('  4/4 Timezone');
  console.log('  ' + '─'.repeat(12));

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezone = await input({
    message: 'Timezone:',
    default: detectedTz || 'UTC',
  });
  console.log(`  ✓ ${timezone}\n`);

  // Save config
  const config: ZarukaConfig = {
    telegram: { botToken: botToken.trim() },
    ai: {
      provider,
      apiKey: apiKey.trim(),
      model: model.trim(),
      baseUrl,
    },
    timezone,
    reminderCron: '0 9 * * *',
  };

  if (!existsSync(ZARUKA_DIR)) {
    mkdirSync(ZARUKA_DIR, { recursive: true });
  }
  mkdirSync(join(ZARUKA_DIR, 'logs'), { recursive: true });

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  chmodSync(CONFIG_PATH, 0o600);

  console.log('  Setup complete!\n');
  console.log('  Start:  zaruka start');
  console.log('  Status: zaruka status');
  console.log('  Help:   zaruka help\n');
}
