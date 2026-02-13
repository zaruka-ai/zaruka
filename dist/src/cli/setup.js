import { input, select, confirm } from '@inquirer/prompts';
import { writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const CONFIG_PATH = join(ZARUKA_DIR, 'config.json');
function isCommandAvailable(cmd) {
    try {
        execSync(`which ${cmd}`, { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
export async function runSetup() {
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
        const data = (await res.json());
        if (data.ok && data.result) {
            console.log(`  ✓ Bot connected: @${data.result.username}\n`);
        }
        else {
            console.log('  ⚠ Could not verify bot token, but continuing...\n');
        }
    }
    catch {
        console.log('  ⚠ Could not reach Telegram API, but continuing...\n');
    }
    // Step 2: AI Provider
    console.log('  2/5 AI Provider');
    console.log('  ' + '─'.repeat(15));
    const providerChoice = await select({
        message: 'Which AI provider would you like to use?',
        choices: [
            { name: 'Anthropic Claude (recommended)', value: 'anthropic' },
            { name: 'OpenAI (GPT-4)', value: 'openai' },
            { name: 'Free local Llama via Ollama (no API key)', value: 'ollama' },
            { name: 'Other OpenAI-compatible API', value: 'openai-compatible' },
        ],
    });
    let provider;
    let apiKey = '';
    let model = '';
    let baseUrl = null;
    if (providerChoice === 'ollama') {
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
        }
        else {
            console.log(`\n  Pulling ${model} (this may take a few minutes)...`);
            try {
                execSync(`ollama pull ${model}`, { stdio: 'inherit', timeout: 600_000 });
                console.log(`  ✓ Model ${model} ready\n`);
            }
            catch {
                console.log(`  ⚠ Could not pull ${model}. Run manually: ollama pull ${model}\n`);
            }
        }
        apiKey = 'ollama';
        baseUrl = 'http://localhost:11434/v1';
    }
    else {
        provider = providerChoice;
        // Step 3: API Key & model
        console.log('\n  3/5 API Key');
        console.log('  ' + '─'.repeat(11));
        let apiKeyHint = '';
        let defaultModel = '';
        if (provider === 'anthropic') {
            apiKeyHint = 'Get your key at console.anthropic.com';
            defaultModel = 'claude-opus-4-6';
        }
        else if (provider === 'openai') {
            apiKeyHint = 'Get your key at platform.openai.com';
            defaultModel = 'gpt-4o';
        }
        else {
            apiKeyHint = 'Enter the API key for your provider';
            defaultModel = 'llama3';
        }
        console.log(`  ${apiKeyHint}\n`);
        apiKey = await input({
            message: 'API Key:',
            validate: (val) => val.trim().length > 0 || 'API key is required',
        });
        model = await input({
            message: 'Model:',
            default: defaultModel,
        });
        if (provider === 'openai-compatible') {
            baseUrl = await input({
                message: 'Base URL:',
                default: 'http://localhost:11434/v1',
            });
        }
        console.log('  ✓ Key saved\n');
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
    let language;
    if (langChoice === 'other') {
        language = await input({
            message: 'Type your language (e.g. "Portuguese", "Korean"):',
            validate: (val) => val.trim().length > 0 || 'Language is required',
        });
    }
    else {
        language = langChoice;
    }
    console.log(`  ✓ ${language === 'auto' ? 'Auto-detect' : language}\n`);
    // Check dependencies for voice transcription
    await checkFfmpeg();
    // Save config
    const config = {
        telegram: { botToken: botToken.trim() },
        ai: {
            provider,
            apiKey: apiKey.trim(),
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
    console.log('  Start:  zaruka start');
    console.log('  Status: zaruka status');
    console.log('  Help:   zaruka help\n');
}
async function setupOllama() {
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
        }
        else {
            console.log('  Installing Ollama...');
            execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit', timeout: 300_000 });
        }
        console.log('  ✓ Ollama installed\n');
    }
    catch {
        console.log('  ⚠ Installation failed. Install manually: https://ollama.com/download\n');
    }
}
async function checkFfmpeg() {
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
        }
        else {
            console.log('  Installing ffmpeg...');
            execSync('sudo apt-get install -y ffmpeg', { stdio: 'inherit', timeout: 300_000 });
        }
        console.log('  ✓ ffmpeg installed\n');
    }
    catch {
        console.log('  ⚠ Installation failed. Install manually: brew install ffmpeg (macOS) / apt install ffmpeg (Linux)\n');
    }
}
//# sourceMappingURL=setup.js.map