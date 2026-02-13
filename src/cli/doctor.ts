import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const CONFIG_PATH = join(ZARUKA_DIR, 'config.json');

export async function runDoctor(): Promise<void> {
  console.log('\n  Zaruka — Doctor\n');
  let allOk = true;

  // 1. Check Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split('.')[0], 10);
  if (major >= 20) {
    console.log(`  ✓ Node.js ${nodeVersion}`);
  } else {
    console.log(`  ✗ Node.js ${nodeVersion} (requires 20+)`);
    allOk = false;
  }

  // 2. Check config file
  if (existsSync(CONFIG_PATH)) {
    console.log('  ✓ Config file exists');
  } else {
    console.log('  ✗ Config file missing (run "zaruka setup")');
    allOk = false;
    console.log('');
    return;
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

  // 3. Check Telegram token
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/getMe`);
    const data = await res.json() as { ok: boolean; result?: { username: string } };
    if (data.ok) {
      console.log(`  ✓ Telegram bot: @${data.result?.username}`);
    } else {
      console.log('  ✗ Telegram bot token is invalid');
      allOk = false;
    }
  } catch {
    console.log('  ✗ Cannot reach Telegram API');
    allOk = false;
  }

  // 4. Check AI provider
  const provider = config.ai?.provider;
  if (provider) {
    console.log(`  ✓ AI provider: ${provider} (${config.ai?.model})`);

    if (provider === 'anthropic') {
      try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');
        const conversation = query({
          prompt: 'Reply with OK',
          options: { model: config.ai.model, maxTurns: 1 },
        });
        let got = false;
        for await (const msg of conversation) {
          if (msg.type === 'result') got = true;
        }
        if (got) {
          console.log('  ✓ Claude Agent SDK is working');
        } else {
          console.log('  ✗ Claude Agent SDK: no response');
          allOk = false;
        }
      } catch (e) {
        console.log(`  ✗ Claude Agent SDK error: ${e instanceof Error ? e.message : e}`);
        allOk = false;
      }
    } else if (!config.ai?.apiKey) {
      console.log('  ✗ API key not configured');
      allOk = false;
    }
  } else {
    console.log('  ✗ AI provider not configured');
    allOk = false;
  }

  // 5. Check SQLite
  try {
    const { getDb } = await import('../db/schema.js');
    const db = getDb();
    db.prepare('SELECT 1').get();
    console.log('  ✓ SQLite database');
    db.close();
  } catch {
    console.log('  ✗ SQLite database error');
    allOk = false;
  }

  console.log('');
  if (allOk) {
    console.log('  All checks passed!\n');
  } else {
    console.log('  Some checks failed. Please fix the issues above.\n');
  }
}
