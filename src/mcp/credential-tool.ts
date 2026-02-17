import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const ENV_FILE = join(ZARUKA_DIR, '.env');

/**
 * Load credentials from ~/.zaruka/.env into process.env.
 * Call this on startup before creating the assistant.
 */
export function loadCredentials(): void {
  if (!existsSync(ENV_FILE)) return;

  try {
    let count = 0;
    const content = readFileSync(ENV_FILE, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && !process.env[key]) {
        process.env[key] = value;
        count++;
      }
    }
    if (count > 0) {
      console.log(`Credentials: loaded ${count} from .env`);
    }
  } catch { /* ignore */ }
}
