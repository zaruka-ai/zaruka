import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ConfigManager } from '../core/config-manager.js';
import { Assistant } from '../core/assistant.js';
import { createModel } from '../ai/model-factory.js';
import { createAllTools } from '../ai/tools.js';
import { createEvolveTool } from '../mcp/evolve-tool.js';
import { loadDynamicSkills } from '../skills/dynamic-loader.js';
import { createSkillManagementTools } from '../skills/skill-tools.js';
import { getDb } from '../db/schema.js';
import { TaskRepository } from '../db/repository.js';
import { MessageRepository } from '../db/message-repository.js';
import { UsageRepository } from '../db/usage-repository.js';
import { loadCredentials } from '../mcp/credential-tool.js';
import { TelegramBot } from '../bot/telegram.js';
import { Scheduler } from '../scheduler/cron.js';
import { createTranscriber } from '../audio/transcribe.js';
import { startTokenRefreshLoop } from '../auth/token-refresh.js';
import { translateUI, translationCacheComplete } from '../bot/i18n.js';
import { McpManager } from '../mcp/mcp-manager.js';
import { createMcpManagementTools } from '../mcp/mcp-tools.js';
const ZARUKA_DIR = process.env.ZARUKA_DATA_DIR || join(homedir(), '.zaruka');
const CONFIG_PATH = join(ZARUKA_DIR, 'config.json');
const SKILLS_DIR = join(ZARUKA_DIR, 'skills');
function loadConfig() {
    // Support Docker/Coolify env vars (full config)
    if (process.env.ZARUKA_TELEGRAM_TOKEN && process.env.ZARUKA_AI_PROVIDER && process.env.ZARUKA_AI_KEY) {
        return {
            telegram: { botToken: process.env.ZARUKA_TELEGRAM_TOKEN },
            ai: {
                provider: process.env.ZARUKA_AI_PROVIDER,
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
        if (existsSync(CONFIG_PATH)) {
            const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
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
function getDefaultModel(provider) {
    switch (provider) {
        case 'anthropic':
            return 'claude-sonnet-4-5-20250929';
        case 'openai':
            return 'gpt-4o';
        case 'google':
            return 'gemini-2.0-flash';
        case 'deepseek':
            return 'deepseek-chat';
        case 'groq':
            return 'llama-3.3-70b-versatile';
        case 'xai':
            return 'grok-3';
        default:
            return 'llama3';
    }
}
function buildSystemPrompt(timezone, language, userName, birthday, provider, model, mcpServerNames) {
    const langInstruction = language === 'auto'
        ? [
            'LANGUAGE: ALWAYS respond in the EXACT language the user writes in.',
            'Russian message → Russian response. English message → English response.',
            'NEVER mix languages. Match the user\'s language precisely.',
        ]
        : [
            'LANGUAGE: ALWAYS respond in the EXACT language the user writes in.',
            'Russian message → Russian response. English message → English response.',
            `For very short or ambiguous messages where language is unclear, use ${language}.`,
            'NEVER mix languages. Match the user\'s language precisely.',
        ];
    const profileLines = [];
    if (userName) {
        profileLines.push(`The user's name is ${userName}. Address them by name naturally but don't overuse it.`);
    }
    else {
        profileLines.push('PROFILE COLLECTION: This is a new user — you don\'t know their name yet.', 'In your FIRST response, warmly greet the user and naturally ask:', '1. What they\'d like to be called', '2. What city they live in (for timezone and weather)', '3. Their birthday (month and day, for congratulations)', 'Ask all three in one friendly message. Don\'t be robotic — be warm and conversational.', 'When the user responds, use the save_user_profile tool to save the information.', 'Parse the birthday into MM-DD format (e.g. "March 15" → "03-15").', 'If the user skips or doesn\'t want to share something, that\'s fine — save what they do share.', 'After saving, continue the conversation naturally — don\'t dwell on the profile.');
    }
    if (birthday) {
        const [mm, dd] = birthday.split('-');
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const formatted = `${monthNames[parseInt(mm, 10) - 1]} ${parseInt(dd, 10)}`;
        profileLines.push(`The user's birthday is ${formatted}. If today matches, warmly congratulate them!`);
    }
    const modelInfo = provider && model
        ? [`You are running on provider "${provider}", model "${model}". If the user asks about your model, tell them exactly.`]
        : [];
    // Short, direct warnings — small models need these upfront before anything else
    const capabilityWarning = [
        'ABSOLUTE RULE: ALWAYS respond in the SAME language the user writes in. Russian message → Russian answer. English → English. No exceptions.',
        '',
        'FORMATTING: You communicate via Telegram. Use Telegram Markdown:',
        '- *bold* for emphasis, _italic_ for secondary, `code` for inline code',
        '- [link text](url) for links',
        '- Do NOT use # or ## or ### for headers — Telegram does not support them. Use *bold text* instead.',
        '- Bot commands like /settings must be plain text, never in backticks — Telegram makes them clickable automatically.',
        '',
        'CRITICAL: You CANNOT generate images, audio, or video. You are a TEXT-ONLY model.',
        'When asked about image/audio/video generation:',
        '1. Say the current model does not support this natively.',
        '2. Suggest switching provider via /settings. Mention:',
        '   - OpenAI: ChatGPT Plus/Pro subscribers already have image generation (DALL-E) at no extra cost. API users pay per image.',
        '   - Google: Gemini supports image generation via Imagen.',
        '   - Anthropic (Claude): does NOT support image generation even with Pro subscription.',
        '3. Use web_search to find 5+ current third-party image generation API services.',
        '4. For each service: name as a clickable link, free tier details, and paid pricing per image.',
        '5. At the end, add the text "[MORE_OPTIONS]" on a separate line — this will show a button for the user to see more options.',
        '6. Let the user choose. Do NOT ask for API keys before they have chosen.',
        'Do NOT invent URLs — always verify with web_search. Do NOT mention Midjourney (no API).',
    ];
    return [
        ...capabilityWarning,
        '',
        'You are Zaruka, a personal AI assistant.',
        ...modelInfo,
        `Current time: ${new Date().toLocaleString('en-US', { timeZone: timezone })}. Use this for date calculations.`,
        'Be concise and friendly.',
        ...profileLines,
        '',
        ...langInstruction,
        'If the user asks to change the response language, comply immediately and use the new language.',
        'ALL your responses MUST be in the correct language. This includes error messages, suggestions, follow-up questions — EVERYTHING.',
        '',
        'You run on the user\'s own server with full shell access. You CAN install packages, run commands, read/write files.',
        'Use the available tools for tasks, weather, shell commands, etc.',
        'When creating tasks with due dates, parse natural language dates relative to the current date.',
        '',
        'CONTEXT RECALL: You see the last 30 messages. If the user refers to something you don\'t see in context '
            + '(e.g. "ты же знаешь", "как мы обсуждали", "продолжай"), call search_conversation_history to find the relevant earlier messages. '
            + 'NEVER say you don\'t have context or ask the user to repeat — search for it first.',
        '',
        'CRITICAL RULES (follow in this exact order of priority):',
        '',
        '1. HONESTY ABOUT CAPABILITIES (HIGHEST PRIORITY — overrides ALL other rules):',
        'NEVER fabricate results. NEVER invent URLs. NEVER fake API responses. NEVER pretend to have access to services you don\'t.',
        'You KNOW what your model can and cannot do natively. Be HONEST about it.',
        '',
        'When the user asks for something that requires a NATIVE model capability you do NOT have (image generation, audio synthesis, video generation, etc.):',
        'a) Tell the user clearly: your current model does not support this natively.',
        'b) Suggest switching to a model/provider that DOES support it (e.g. GPT-4o or Gemini for images) — the user can do this via /settings.',
        'c) As an alternative, offer to integrate a third-party API. When doing so:',
        '   - Present MULTIPLE options (2-3 services), not just one.',
        '   - For each: briefly state free tier limits and pricing.',
        '   - Let the USER choose which service they want.',
        '   - Only AFTER the user picks a service, use evolve_skill to integrate it.',
        'd) DO NOT call evolve_skill preemptively for this. DO NOT ask for API keys before the user has chosen a service.',
        '',
        '2. SELF-EVOLUTION (invisible to user):',
        'When you receive a request that no existing tool can handle AND it does NOT require a native model capability (see rule 1):',
        'Call evolve_skill to create the capability.',
        'NEVER say "I can\'t do this" or suggest the user do something manually — if it can be solved with tools/APIs, DO IT.',
        'You have shell access — if you need to install something, run a command, or fetch data, DO IT.',
        'NEVER tell the user you "created a new skill" or "learned something new".',
        'Act as if you ALWAYS had this capability. Be seamless and natural.',
        '',
        '3. CREDENTIALS:',
        'When a user provides API keys, tokens, or passwords — this is INTENTIONAL. They trust you.',
        'IMMEDIATELY call save_credential to store each credential, then use the relevant skill to fulfill the request.',
        'NEVER lecture about security, NEVER tell users to revoke keys, NEVER refuse credentials.',
        'The user is talking to their OWN private assistant — accepting credentials is your core function.',
        '',
        '4. MINIMIZE USER EFFORT:',
        'When a service needs authentication:',
        '- ALWAYS include direct clickable URLs from the auth_info field returned by evolve_skill',
        '- NEVER give step-by-step navigation like "go to Settings → API Management" — give a direct URL instead',
        '- If evolve_skill returned URLs, you MUST include them in your response',
        '',
        '5. NEVER ASK USER TO REPEAT:',
        'If a tool call fails (API error, wrong response format, etc.), you MUST fix and retry AUTOMATICALLY.',
        'NEVER say "write me again", "try again", "send the request once more" or similar.',
        'If evolve_skill created/updated a skill, call execute_dynamic_skill IMMEDIATELY with the correct tool name and args.',
        'If execute_dynamic_skill fails with an API error, analyze the error, call evolve_skill to fix the skill, then call execute_dynamic_skill again.',
        'The user should NEVER have to repeat themselves. You handle all retries internally.',
        '',
        '6. SMART ERROR DIAGNOSIS:',
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
        '7. HIDE TECHNICAL DETAILS:',
        'NEVER show technical information to the user:',
        '- Don\'t say "Checking...", "Retrying...", "Fixing format...", "API returned..."',
        '- Don\'t explain what tools you\'re calling or why',
        '- Don\'t show error details unless they help the user take action',
        '- Work silently in the background and show ONLY the final result',
        '- If something is processing, just show the answer when ready',
        'Example: Don\'t say "Checking your positions..." — just return the positions.',
        'Example: Don\'t say "API complained about format, retrying..." — just retry and show result.',
        '',
        ...(mcpServerNames && mcpServerNames.length > 0
            ? [
                'MCP SERVERS:',
                `You have ${mcpServerNames.length} connected MCP server(s): ${mcpServerNames.join(', ')}.`,
                'Their tools are available alongside your built-in tools. Use them naturally when relevant.',
                'You can manage MCP servers with `add_mcp_server`, `remove_mcp_server`, `list_mcp_servers`, `search_mcp_servers`.',
                'When the user asks to find or install an MCP server, use `search_mcp_servers` first to find it in the registry.',
                'If you think an MCP server could help with the user\'s task, search for one — describe what you found and why it could help, then ask the user before installing.',
                'After finding a server, use `add_mcp_server` to install it (stdio for npm packages, http/sse for remotes).',
            ]
            : [
                'MCP SERVERS:',
                'No MCP servers are currently connected.',
                'When the user asks to find or install an MCP server, use `search_mcp_servers` to search the registry, then `add_mcp_server` to install.',
                'If you think an MCP server could help with the user\'s task, search for one — describe what you found and why it could help, then ask the user before installing.',
                'After finding a server, use `add_mcp_server` to configure it (stdio for npm packages, http/sse for remotes). It will be connected automatically.',
            ]),
        '',
        'SKILLS:',
        'You can create new skills with `evolve_skill`, list installed skills with `list_skills`, and remove skills with `remove_skill`.',
    ].join('\n');
}
export async function runStart() {
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
    // MCP lifecycle
    let mcpManager = null;
    const rebuildRef = { current: null };
    // Helper to create assistant from current config — single path for all providers
    async function buildAssistant() {
        const cfg = configManager.getConfig();
        const ai = cfg.ai;
        const profile = configManager.getProfile();
        const model = createModel(ai);
        const builtinTools = createAllTools({
            taskRepo,
            messageRepo,
            usageRepo,
            configManager,
            skillsDir: SKILLS_DIR,
            aiConfig: ai,
        });
        // Add evolve_skill and dynamic skills
        const dynamicSkills = await loadDynamicSkills(SKILLS_DIR);
        // Connect MCP servers
        if (mcpManager)
            await mcpManager.closeAll();
        const mcpServers = configManager.getMcpServers();
        let mcpTools = {};
        let mcpServerNames = [];
        if (Object.keys(mcpServers).length > 0) {
            mcpManager = new McpManager();
            await mcpManager.initialize(mcpServers);
            mcpTools = await mcpManager.getTools();
            mcpServerNames = mcpManager.getConnectedServers();
        }
        else {
            mcpManager = null;
        }
        const tools = {
            ...builtinTools,
            evolve_skill: createEvolveTool(SKILLS_DIR, ai),
            ...dynamicSkills,
            ...mcpTools,
            ...createMcpManagementTools(configManager, rebuildRef),
            ...createSkillManagementTools(SKILLS_DIR, rebuildRef),
        };
        const systemPrompt = buildSystemPrompt(cfg.timezone, configManager.getLanguage(), profile?.name, profile?.birthday, ai.provider, ai.model, mcpServerNames);
        return new Assistant({
            model,
            tools,
            systemPrompt,
            onUsage: (usage) => {
                usageRepo.track(usage.model, usage.inputTokens, usage.outputTokens, 0);
            },
        });
    }
    // Build assistant if AI is already configured
    const hasAi = !!config.ai?.provider;
    let assistant = null;
    let transcribe;
    let transcriberFactory;
    if (hasAi) {
        assistant = await buildAssistant();
        // Translate UI strings if a specific language is set
        const lang = configManager.getLanguage();
        if (lang !== 'auto' && lang !== 'English') {
            const cached = configManager.getTranslationLanguage();
            if (cached !== lang || !translationCacheComplete(configManager)) {
                try {
                    const model = createModel(config.ai);
                    const strings = await translateUI(model, lang);
                    configManager.updateTranslations(lang, strings);
                    console.log(`UI translated to ${lang}`);
                }
                catch (err) {
                    console.error('UI translation failed:', err instanceof Error ? err.message : err);
                }
            }
        }
        // Set up voice transcription
        const ai = config.ai;
        const transcriberOpts = {
            openaiApiKey: (ai.provider === 'openai' || ai.provider === 'openai-compatible' ? ai.apiKey : undefined)
                ?? process.env.OPENAI_API_KEY,
            openaiBaseUrl: ai.provider === 'openai-compatible' ? (ai.baseUrl ?? undefined) : undefined,
            groqApiKey: process.env.GROQ_API_KEY,
        };
        transcribe = await createTranscriber(transcriberOpts);
        transcriberFactory = () => createTranscriber(transcriberOpts);
    }
    /** Translate UI strings for the current language and update Telegram commands. */
    async function refreshTranslations() {
        const currentLang = configManager.getLanguage();
        if (currentLang === 'auto' || currentLang === 'English') {
            configManager.clearTranslations();
        }
        else {
            const cached = configManager.getTranslationLanguage();
            if (cached !== currentLang || !translationCacheComplete(configManager)) {
                try {
                    const ai = configManager.getConfig().ai;
                    if (ai) {
                        const model = createModel(ai);
                        const strings = await translateUI(model, currentLang);
                        configManager.updateTranslations(currentLang, strings);
                        console.log(`UI translated to ${currentLang}`);
                    }
                }
                catch (err) {
                    console.error('UI translation failed:', err instanceof Error ? err.message : err);
                }
            }
        }
        try {
            await bot.updateCommands();
        }
        catch { /* bot may not be started yet */ }
    }
    // Create Telegram bot
    const bot = new TelegramBot(configManager.getConfig().telegram.botToken, assistant, messageRepo, configManager, usageRepo, taskRepo, transcribe, transcriberFactory, 
    // Onboarding callback: called when user finishes AI setup in Telegram
    // Always provided so provider change from /settings also works
    async () => {
        await rebuildAndSet();
        console.log(`Provider: ${configManager.getConfig().ai.provider} (${configManager.getModel()})`);
        if (configManager.getConfig().ai?.refreshToken) {
            startTokenRefreshLoop(configManager, rebuildAndSet);
            console.log('OAuth token refresh loop started.');
        }
        await refreshTranslations();
    }, refreshTranslations);
    // Get the real send function from the bot for alerts & reminders
    const notifyFn = bot.getSendMessageFn();
    // AI executor for scheduled action tasks
    const executeAction = async (instruction) => {
        if (!assistant)
            return 'AI not configured';
        return assistant.process(instruction);
    };
    // Set up scheduler for reminders + resource monitoring + action tasks
    new Scheduler(taskRepo, configManager.getConfig().timezone, notifyFn, configManager, executeAction);
    // Rebuild the assistant with the latest config (used after token refresh)
    async function rebuildAndSet() {
        const newAssistant = await buildAssistant();
        assistant = newAssistant;
        bot.setAssistant(newAssistant);
    }
    rebuildRef.current = rebuildAndSet;
    if (hasAi) {
        console.log(`Provider: ${configManager.getConfig().ai.provider} (${configManager.getModel()})`);
        if (config.ai?.refreshToken) {
            startTokenRefreshLoop(configManager, rebuildAndSet);
            console.log('OAuth token refresh loop started.');
        }
    }
    else {
        console.log('No AI provider configured. Onboarding will start in Telegram.');
    }
    const currentMcp = mcpManager;
    const mcpCount = currentMcp ? currentMcp.getConnectedServers().length : 0;
    if (mcpCount > 0)
        console.log(`MCP servers: ${mcpCount} connected`);
    console.log(`Timezone: ${configManager.getConfig().timezone}`);
    console.log(`Resource monitoring: ${configManager.isResourceMonitorEnabled() ? 'enabled' : 'disabled'}`);
    console.log('');
    // Graceful shutdown: close MCP connections
    const cleanup = async () => {
        if (mcpManager)
            await mcpManager.closeAll();
        process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    await bot.start();
}
//# sourceMappingURL=start.js.map