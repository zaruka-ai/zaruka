import { input, select, confirm } from '@inquirer/prompts';
import { writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { ZarukaConfig } from '../core/types.js';

const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const CONFIG_PATH = join(ZARUKA_DIR, 'config.json');

function isCommandAvailable(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function runSetup(): Promise<void> {
  console.log('\n  Zaruka — Setup\n');
  console.log('  Let\'s set up your assistant!\n');

  // Step 1: Telegram Bot Token
  console.log('  1/5 Telegram Bot Token');
  console.log('  ' + '─'.repeat(21));
  console.log('  Create a bot via @BotFather in Telegram and paste the token.');
  console.log('  Guide: https://core.telegram.org/bots#botfather\n');

  const botToken = await input({
    message: 'Token:',
    validate: (val) => val.trim().length > 10 || 'Please enter a valid bot token',
  });

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken.trim()}/getMe`);
    const data = (await res.json()) as { ok: boolean; result?: { username: string } };
    if (data.ok && data.result) {
      console.log(`  ✓ Bot connected: @${data.result.username}\n`);
    } else {
      console.log('  ⚠ Could not verify bot token, but continuing...\n');
    }
  } catch {
    console.log('  ⚠ Could not reach Telegram API, but continuing...\n');
  }

  // Step 2: AI Provider
  console.log('  2/5 AI Provider');
  console.log('  ' + '─'.repeat(15));

  const providerChoice = await select({
    message: 'Which AI provider would you like to use?',
    choices: [
      { name: 'Anthropic Claude via Claude Code (subscription/OAuth)', value: 'anthropic-oauth' as const },
      { name: 'Anthropic Claude via API Key (pay-as-you-go)', value: 'anthropic-api' as const },
      { name: 'OpenAI via Codex CLI (ChatGPT Plus/Pro subscription)', value: 'openai-oauth' as const },
      { name: 'OpenAI via API Key (pay-as-you-go)', value: 'openai-api' as const },
      { name: 'Free local Llama via Ollama (no API key)', value: 'ollama' as const },
      { name: 'Other OpenAI-compatible API', value: 'openai-compatible' as const },
    ],
  });

  let provider: ZarukaConfig['ai']['provider'];
  let apiKey = '';
  let authToken = '';
  let model = '';
  let baseUrl: string | null = null;

  if (providerChoice === 'anthropic-oauth') {
    provider = 'anthropic';

    console.log('\n  Claude Code OAuth Setup');
    console.log('  ' + '─'.repeat(23));
    console.log('  This uses your Claude Pro subscription (no additional API costs).\n');

    const authMethod = await select({
      message: 'Choose authentication method:',
      choices: [
        { name: 'Browser OAuth (recommended)', value: 'browser' as const },
        { name: 'Manual token entry (for SSH/headless)', value: 'manual' as const },
      ],
    });

    if (authMethod === 'browser') {
      console.log('\n  Starting OAuth flow...\n');
      console.log('  Run this command in your terminal:\n');
      console.log('    claude code setup --use-oauth\n');
      console.log('  Follow the link in your browser to authorize.\n');
      console.log('  After authorization, find your token in ~/.anthropic/\n');

      const continueSetup = await confirm({
        message: 'Have you completed the OAuth setup?',
        default: false,
      });

      if (continueSetup) {
        console.log('\n  Looking for OAuth token...\n');
        try {
          const anthropicDir = join(homedir(), '.anthropic');
          // Try to read token from Claude Code CLI config
          const authFiles = ['auth.json', 'session.json', 'oauth.json'];
          let foundToken = '';

          for (const file of authFiles) {
            const path = join(anthropicDir, file);
            if (existsSync(path)) {
              try {
                const data = JSON.parse(readFileSync(path, 'utf-8'));
                if (data.token || data.access_token || data.authToken) {
                  foundToken = data.token || data.access_token || data.authToken;
                  break;
                }
              } catch { /* skip */ }
            }
          }

          if (foundToken) {
            authToken = foundToken;
            console.log('  ✓ OAuth token found automatically!\n');
          } else {
            console.log('  ⚠ Token not found. Please enter manually:\n');
            authToken = await input({
              message: 'OAuth Token:',
              validate: (val) => {
                if (val.trim().length === 0) return 'Token is required';
                if (!val.startsWith('sk-ant-oat01-')) return 'Invalid OAuth token format';
                return true;
              },
            });
          }
        } catch {
          console.log('  ⚠ Could not read token automatically. Please enter manually:\n');
          authToken = await input({
            message: 'OAuth Token:',
            validate: (val) => {
              if (val.trim().length === 0) return 'Token is required';
              if (!val.startsWith('sk-ant-oat01-')) return 'Invalid OAuth token format';
              return true;
            },
          });
        }
      } else {
        console.log('\n  Please complete OAuth setup and run "npm run setup" again.\n');
        process.exit(0);
      }
    } else {
      // Manual token entry
      console.log('\n  To get your OAuth token:');
      console.log('  1. Visit: https://claude.ai/settings/oauth-setup');
      console.log('  2. Click "Generate Setup Token"');
      console.log('  3. Copy the token (starts with sk-ant-oat01-...)\n');

      authToken = await input({
        message: 'OAuth Setup Token:',
        validate: (val) => {
          if (val.trim().length === 0) return 'Token is required';
          if (!val.startsWith('sk-ant-oat01-')) return 'Invalid OAuth token format (should start with sk-ant-oat01-)';
          return true;
        },
      });
    }

    model = await input({
      message: 'Model:',
      default: 'claude-opus-4-6',
    });

    console.log('  ✓ OAuth token saved\n');
  } else if (providerChoice === 'anthropic-api') {
    provider = 'anthropic';

    console.log('\n  3/5 API Key');
    console.log('  ' + '─'.repeat(11));
    console.log('  Get your API key at: https://console.anthropic.com/settings/keys\n');

    apiKey = await input({
      message: 'API Key:',
      validate: (val) => {
        if (val.trim().length === 0) return 'API key is required';
        if (!val.startsWith('sk-ant-api03-')) return 'Invalid API key format (should start with sk-ant-api03-)';
        return true;
      },
    });

    model = await input({
      message: 'Model:',
      default: 'claude-opus-4-6',
    });

    console.log('  ✓ Key saved\n');
  } else if (providerChoice === 'openai-oauth') {
    provider = 'openai';

    console.log('\n  OpenAI Codex OAuth Setup');
    console.log('  ' + '─'.repeat(24));
    console.log('  This uses your ChatGPT Plus/Pro subscription (no additional API costs).\n');

    const authMethod = await select({
      message: 'Choose authentication method:',
      choices: [
        { name: 'Browser OAuth (recommended)', value: 'browser' as const },
        { name: 'Device Code (for SSH/headless)', value: 'device' as const },
        { name: 'Manual token entry', value: 'manual' as const },
      ],
    });

    if (authMethod === 'browser') {
      console.log('\n  Starting OAuth flow...\n');
      console.log('  First, install Codex CLI (if not already installed):\n');
      console.log('    npm install -g @openai/codex-cli\n');
      console.log('  Then run:\n');
      console.log('    codex logout   # if previously used API key');
      console.log('    codex login    # start OAuth flow\n');
      console.log('  Follow the link in your browser to authorize.\n');

      const continueSetup = await confirm({
        message: 'Have you completed the OAuth setup?',
        default: false,
      });

      if (continueSetup) {
        console.log('\n  Looking for session token...\n');
        try {
          const openaiDir = join(homedir(), '.openai');
          const sessionPath = join(openaiDir, 'session.json');

          if (existsSync(sessionPath)) {
            const data = JSON.parse(readFileSync(sessionPath, 'utf-8'));
            if (data.access_token || data.token || data.session_token) {
              authToken = data.access_token || data.token || data.session_token;
              console.log('  ✓ Session token found automatically!\n');
            } else {
              console.log('  ⚠ Token not found in session.json. Please enter manually:\n');
              authToken = await input({
                message: 'Session Token:',
                validate: (val) => val.trim().length > 0 || 'Token is required',
              });
            }
          } else {
            console.log('  ⚠ ~/.openai/session.json not found. Please enter token manually:\n');
            authToken = await input({
              message: 'Session Token:',
              validate: (val) => val.trim().length > 0 || 'Token is required',
            });
          }
        } catch {
          console.log('  ⚠ Could not read token automatically. Please enter manually:\n');
          authToken = await input({
            message: 'Session Token:',
            validate: (val) => val.trim().length > 0 || 'Token is required',
          });
        }
      } else {
        console.log('\n  Please complete OAuth setup and run "npm run setup" again.\n');
        process.exit(0);
      }
    } else if (authMethod === 'device') {
      console.log('\n  Device Code Flow (for headless/SSH environments)\n');
      console.log('  This method works without browser access on the same machine.\n');
      console.log('  Install device auth plugin:\n');
      console.log('    npm install -g @openai/codex-device-auth\n');
      console.log('  Then run:\n');
      console.log('    codex-device-auth\n');
      console.log('  You\'ll get a code to enter at a URL from any device with a browser.\n');

      const continueSetup = await confirm({
        message: 'Have you completed the device authorization?',
        default: false,
      });

      if (continueSetup) {
        authToken = await input({
          message: 'Session Token (from ~/.openai/session.json):',
          validate: (val) => val.trim().length > 0 || 'Token is required',
        });
      } else {
        console.log('\n  Please complete device authorization and run "npm run setup" again.\n');
        process.exit(0);
      }
    } else {
      // Manual token entry
      console.log('\n  Manual Token Entry\n');
      console.log('  If you already have a session token, paste it here.\n');
      console.log('  You can find it in ~/.openai/session.json after running "codex login"\n');

      authToken = await input({
        message: 'Session Token:',
        validate: (val) => val.trim().length > 0 || 'Token is required',
      });
    }

    model = await input({
      message: 'Model:',
      default: 'gpt-4o',
    });

    console.log('  ✓ Session token saved\n');
  } else if (providerChoice === 'openai-api') {
    provider = 'openai';

    console.log('\n  3/5 API Key');
    console.log('  ' + '─'.repeat(11));
    console.log('  Get your API key at: https://platform.openai.com/api-keys\n');

    apiKey = await input({
      message: 'API Key:',
      validate: (val) => val.trim().length > 0 || 'API key is required',
    });

    model = await input({
      message: 'Model:',
      default: 'gpt-4o',
    });

    console.log('  ✓ Key saved\n');
  } else if (providerChoice === 'ollama') {
    provider = 'openai-compatible';
    await setupOllama();

    model = await input({
      message: 'Ollama model:',
      default: 'llama3.2',
    });

    // Check system resources before pulling model
    const { checkInstallationFeasibility } = await import('../monitor/resources.js');
    const check = checkInstallationFeasibility(5, 4); // 5 GB disk, 4 GB RAM
    let skipPull = false;
    if (!check.feasible) {
      console.log('\n  ⚠ Resource warnings:');
      for (const w of check.warnings) {
        console.log(`    - ${w}`);
      }
      skipPull = !(await confirm({ message: 'Continue pulling model anyway?', default: false }));
    }

    if (skipPull) {
      console.log(`  Skipping model pull. Run manually: ollama pull ${model}\n`);
    } else {
      console.log(`\n  Pulling ${model} (this may take a few minutes)...`);
      try {
        execSync(`ollama pull ${model}`, { stdio: 'inherit', timeout: 600_000 });
        console.log(`  ✓ Model ${model} ready\n`);
      } catch {
        console.log(`  ⚠ Could not pull ${model}. Run manually: ollama pull ${model}\n`);
      }
    }

    apiKey = 'ollama';
    baseUrl = 'http://localhost:11434/v1';
  } else {
    // openai-compatible
    provider = 'openai-compatible';

    console.log('\n  3/5 API Key & Base URL');
    console.log('  ' + '─'.repeat(23));
    console.log('  Enter the API key and base URL for your OpenAI-compatible provider.\n');

    apiKey = await input({
      message: 'API Key:',
      validate: (val) => val.trim().length > 0 || 'API key is required',
    });

    model = await input({
      message: 'Model:',
      default: 'llama3',
    });

    baseUrl = await input({
      message: 'Base URL:',
      default: 'http://localhost:11434/v1',
    });

    console.log('  ✓ Config saved\n');
  }

  // Step 4: Timezone
  console.log('  4/5 Timezone');
  console.log('  ' + '─'.repeat(12));

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezone = await input({
    message: 'Timezone:',
    default: detectedTz || 'UTC',
  });
  console.log(`  ✓ ${timezone}\n`);

  // Step 5: Language
  console.log('  5/5 Language');
  console.log('  ' + '─'.repeat(12));
  console.log('  Choose the language your assistant will use.\n');

  const langChoice = await select({
    message: 'Preferred language:',
    choices: [
      { name: 'Auto-detect from messages (recommended)', value: 'auto' },
      { name: 'English', value: 'English' },
      { name: 'Русский', value: 'Russian' },
      { name: 'Español', value: 'Spanish' },
      { name: 'Français', value: 'French' },
      { name: 'Deutsch', value: 'German' },
      { name: 'Italiano', value: 'Italian' },
      { name: '中文', value: 'Chinese' },
      { name: '日本語', value: 'Japanese' },
      { name: 'Other', value: 'other' },
    ],
  });

  let language: string;
  if (langChoice === 'other') {
    language = await input({
      message: 'Type your language (e.g. "Portuguese", "Korean"):',
      validate: (val) => val.trim().length > 0 || 'Language is required',
    });
  } else {
    language = langChoice;
  }
  console.log(`  ✓ ${language === 'auto' ? 'Auto-detect' : language}\n`);

  // Check dependencies for voice transcription
  await checkFfmpeg();

  // Save config
  const config: ZarukaConfig = {
    telegram: { botToken: botToken.trim() },
    ai: {
      provider,
      ...(apiKey ? { apiKey: apiKey.trim() } : {}),
      ...(authToken ? { authToken: authToken.trim() } : {}),
      model: model.trim(),
      baseUrl,
    },
    timezone,
    language,
    reminderCron: '0 9 * * *',
  };

  if (!existsSync(ZARUKA_DIR)) {
    mkdirSync(ZARUKA_DIR, { recursive: true });
  }
  mkdirSync(join(ZARUKA_DIR, 'logs'), { recursive: true });

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  chmodSync(CONFIG_PATH, 0o600);

  console.log('  Setup complete!\n');
  console.log('  Start:  npm run dev');
  console.log('  Or:     npm start (production)\n');
}

async function setupOllama(): Promise<void> {
  if (isCommandAvailable('ollama')) {
    console.log('  ✓ Ollama is installed\n');
    return;
  }

  console.log('\n  Ollama is not installed.');
  const shouldInstall = await confirm({
    message: 'Install Ollama now?',
    default: true,
  });

  if (!shouldInstall) {
    console.log('  Install manually: https://ollama.com/download\n');
    return;
  }

  const os = platform();
  try {
    if (os === 'darwin') {
      console.log('  Installing Ollama via Homebrew...');
      execSync('brew install ollama', { stdio: 'inherit', timeout: 300_000 });
    } else {
      console.log('  Installing Ollama...');
      execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit', timeout: 300_000 });
    }
    console.log('  ✓ Ollama installed\n');
  } catch {
    console.log('  ⚠ Installation failed. Install manually: https://ollama.com/download\n');
  }
}

async function checkFfmpeg(): Promise<void> {
  if (isCommandAvailable('ffmpeg')) {
    console.log('  ✓ ffmpeg available (voice transcription ready)\n');
    return;
  }

  console.log('  ffmpeg is not installed (needed for voice message transcription).');
  const shouldInstall = await confirm({
    message: 'Install ffmpeg now?',
    default: true,
  });

  if (!shouldInstall) {
    console.log('  Voice transcription will be disabled until ffmpeg is installed.\n');
    return;
  }

  const os = platform();
  try {
    if (os === 'darwin') {
      console.log('  Installing ffmpeg via Homebrew...');
      execSync('brew install ffmpeg', { stdio: 'inherit', timeout: 300_000 });
    } else {
      console.log('  Installing ffmpeg...');
      execSync('sudo apt-get install -y ffmpeg', { stdio: 'inherit', timeout: 300_000 });
    }
    console.log('  ✓ ffmpeg installed\n');
  } catch {
    console.log('  ⚠ Installation failed. Install manually: brew install ffmpeg (macOS) / apt install ffmpeg (Linux)\n');
  }
}
