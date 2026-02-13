import { z } from 'zod/v4';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const ENV_FILE = join(ZARUKA_DIR, '.env');
/**
 * Load credentials from ~/.zaruka/.env into process.env.
 * Call this on startup before creating the MCP server.
 */
export function loadCredentials() {
    if (!existsSync(ENV_FILE))
        return;
    try {
        const content = readFileSync(ENV_FILE, 'utf-8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#'))
                continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1)
                continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const value = trimmed.slice(eqIdx + 1).trim();
            if (key && !process.env[key]) {
                process.env[key] = value;
            }
        }
        const count = content.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('=')).length;
        if (count > 0) {
            console.log(`Credentials: loaded ${count} from .env`);
        }
    }
    catch { /* ignore */ }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createCredentialTool() {
    return tool('save_credential', 'Save a user-provided credential (API key, token, login, password) so it can be used by skills. '
        + 'The credential is stored securely and available immediately. '
        + 'Use SCREAMING_SNAKE_CASE for the name (e.g. FREEDOM_FINANCE_API_KEY).', {
        name: z.string().describe('Environment variable name in SCREAMING_SNAKE_CASE (e.g. FREEDOM_FINANCE_API_KEY)'),
        value: z.string().describe('The credential value to save'),
    }, async (args) => {
        const { name, value } = args;
        // Validate name format
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ error: 'Invalid name. Use SCREAMING_SNAKE_CASE (e.g. MY_API_KEY)' }),
                    }],
            };
        }
        // Set in current process immediately
        process.env[name] = value;
        // Persist to .env file
        try {
            let lines = [];
            if (existsSync(ENV_FILE)) {
                lines = readFileSync(ENV_FILE, 'utf-8').split('\n');
            }
            // Update existing or append
            const prefix = `${name}=`;
            const existingIdx = lines.findIndex((l) => l.startsWith(prefix));
            if (existingIdx !== -1) {
                lines[existingIdx] = `${name}=${value}`;
            }
            else {
                // Remove trailing empty lines before appending
                while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
                    lines.pop();
                }
                lines.push(`${name}=${value}`);
            }
            writeFileSync(ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 });
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            name,
                            message: `Credential ${name} saved and available immediately. You can now use tools that require it.`,
                        }),
                    }],
            };
        }
        catch (err) {
            // Even if file write fails, process.env is set for this session
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            name,
                            message: `Credential ${name} set for this session (file save failed: ${err}). It will be available until restart.`,
                        }),
                    }],
            };
        }
    });
}
//# sourceMappingURL=credential-tool.js.map