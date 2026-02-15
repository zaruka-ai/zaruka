import { z } from 'zod/v4';
import { tool, query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const SKILL_TEMPLATE = `
import { z } from 'zod/v4';
import { tool } from '@anthropic-ai/claude-agent-sdk';
// For Node builtins use: import { createHash } from 'node:crypto';
// NEVER use require() — ESM only!

export const tools = [
  tool(
    'TOOL_NAME',
    'TOOL_DESCRIPTION',
    {
      // define input schema with zod (e.g. query: z.string())
    },
    async (args) => {
      // implement the tool logic using fetch() for HTTP requests
      return { content: [{ type: 'text', text: JSON.stringify({ result: 'TODO' }) }] };
    },
  ),
];
`.trim();
/**
 * Quick web search via DuckDuckGo HTML to find real URLs before spawning the inner agent.
 * Returns list of URLs and page snippets.
 */
async function preResearch(description) {
    const urls = [];
    const snippets = [];
    const pages = [];
    // Extract service name from description for better search
    const searchQuery = description.slice(0, 100) + ' API documentation authorization';
    try {
        const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            signal: AbortSignal.timeout(15000),
        });
        const html = await resp.text();
        // DuckDuckGo wraps result URLs as //duckduckgo.com/l/?uddg=ENCODED_URL
        const uddgMatches = [...html.matchAll(/uddg=([^&"]+)/g)];
        const rawUrls = uddgMatches
            .map((m) => { try {
            return decodeURIComponent(m[1]);
        }
        catch {
            return '';
        } })
            .filter((u) => u.startsWith('http') && !u.includes('duckduckgo.com'));
        urls.push(...[...new Set(rawUrls)].slice(0, 10));
        // Extract snippets from result descriptions
        const snippetMatches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\//g)];
        for (const m of snippetMatches.slice(0, 5)) {
            const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (text.length > 20)
                snippets.push(text);
        }
    }
    catch (err) {
        console.log('Pre-research search failed:', err);
    }
    // Fetch top 3 pages to extract documentation content
    for (const url of urls.slice(0, 3)) {
        try {
            const resp = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
                signal: AbortSignal.timeout(10000),
                redirect: 'follow',
            });
            if (!resp.ok)
                continue;
            const contentType = resp.headers.get('content-type') || '';
            if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json'))
                continue;
            const body = await resp.text();
            // Strip scripts, styles, HTML tags
            const text = body
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 3000);
            if (text.length > 100) {
                pages.push(`=== Content from ${url} ===\n${text}`);
            }
        }
        catch { /* skip unreachable pages */ }
    }
    return { urls, snippets, pages };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createEvolveTool(skillsDir, authToken, model) {
    return tool('evolve_skill', 'SELF-EVOLUTION: Create a new skill that adds capabilities you don\'t have yet. You MUST call this tool whenever a user asks for something no existing tool can do — BEFORE saying you cannot help. The new skill will be available on the next message. Be creative: use public APIs, web scraping, calculations, etc.', {
        skill_name: z.string().describe('Short snake_case name for the skill (e.g. "currency_converter", "translator")'),
        description: z.string().describe('Detailed description of what the skill should do, including expected inputs and outputs'),
    }, async (args) => {
        if (!existsSync(skillsDir)) {
            mkdirSync(skillsDir, { recursive: true });
        }
        const fileName = `${args.skill_name}.js`;
        const filePath = resolve(skillsDir, fileName);
        // Pre-research: find real documentation URLs before spawning inner agent
        console.log(`evolve_skill: pre-researching "${args.skill_name}"...`);
        const research = await preResearch(args.description);
        console.log(`evolve_skill: found ${research.urls.length} URLs, ${research.pages.length} pages`);
        const researchContext = research.urls.length > 0
            ? [
                '',
                '=== PRE-RESEARCH RESULTS (real web search) ===',
                'These URLs were found by searching the web. They are REAL and verified:',
                ...research.urls.map((u) => `- ${u}`),
                '',
                ...(research.snippets.length > 0
                    ? ['Search result snippets:', ...research.snippets.map((s) => `- ${s}`), '']
                    : []),
                ...(research.pages.length > 0
                    ? ['Documentation content extracted from the pages above:', ...research.pages, '']
                    : []),
                'Use WebFetch to read more from these URLs if you need additional details.',
                'IMPORTANT: Use these real URLs in your auth_url fields, NOT made-up ones.',
            ].join('\n')
            : '';
        const cleanEnv = { ...process.env };
        delete cleanEnv.CLAUDECODE;
        if (authToken) {
            cleanEnv.CLAUDE_CODE_OAUTH_TOKEN = authToken;
        }
        const prompt = [
            `Create a skill file at ${filePath} that: ${args.description}`,
            researchContext,
            '',
            '=== STEP 1: ANALYZE DOCUMENTATION ===',
            research.pages.length > 0
                ? 'Documentation has already been fetched above. Read it carefully and extract:'
                : 'Use WebFetch to read the URLs found above (or search with WebSearch if no URLs found). Extract:',
            '- API base URL and endpoints',
            '- Authentication methods (API key, OAuth, login/password, etc.)',
            '- Required parameters and response format',
            '- Direct URLs where users can get API keys or authorize',
            '',
            '=== STEP 2: WRITE CODE ===',
            'Create the skill file following this pattern:',
            SKILL_TEMPLATE,
            '',
            'CRITICAL: The file MUST be plain JavaScript (.js) ESM module, NOT TypeScript, NOT CommonJS.',
            '- NO type annotations (no `: string`, `: number`, etc.)',
            '- NO TypeScript keywords (`type`, `interface`, `as`, `<generic>`)',
            '- NEVER use require() — it does NOT exist in ESM. Use import instead.',
            '- For Node builtins: `import { createHash } from "node:crypto"` (NOT `require("crypto")`)',
            '- For top-level imports only, no dynamic require()',
            '- Just standard ES module JavaScript with import/export',
            '',
            'Requirements:',
            '- Import z from "zod/v4" and tool from "@anthropic-ai/claude-agent-sdk"',
            '- Export a `tools` array of tool() calls',
            '- Each tool returns { content: [{ type: "text", text: JSON.stringify(result) }] }',
            '- Use fetch() for HTTP requests (no extra deps)',
            '- Do NOT import child_process, fs.writeFileSync, or any dangerous modules',
            `- Write the file to: ${filePath}`,
            '',
            'Auth handling:',
            '- Read credentials from env variables (e.g. process.env.SERVICE_NAME_API_KEY)',
            '- When credentials are missing, return JSON with:',
            '  { error: "auth_required", auth_url: "REAL URL from documentation", auth_methods: [...], message: "clear instructions" }',
            '- auth_url MUST come from the documentation found above — NEVER invent URLs',
            '- Include ALL auth methods you found (API key, OAuth, login/password)',
            '',
            '=== STEP 3: SUMMARY ===',
            'Output a brief summary:',
            '- What API documentation you found (with real URLs)',
            '- What auth methods are available',
            '- What env variables the user needs to set',
            '- Direct URL where the user can get credentials',
        ].join('\n');
        let resultText = '';
        const conversation = query({
            prompt,
            options: {
                model: model || 'claude-sonnet-4-5-20250929',
                systemPrompt: [
                    `You are a skill developer for the Zaruka AI assistant. You create JavaScript skill files in ${skillsDir}.`,
                    '',
                    'YOUR #1 RULE: Use ONLY real URLs from the pre-research results or from WebFetch/WebSearch.',
                    'NEVER invent or guess URLs. If you cannot find real documentation, include that in your summary.',
                    'The pre-research section contains URLs that were actually found on the web — prefer those.',
                ].join('\n'),
                maxTurns: 6,
                tools: ['Read', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
                cwd: skillsDir,
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                env: cleanEnv,
                canUseTool: async (toolName, input) => {
                    // Block writes outside skills dir
                    if (toolName === 'Write' || toolName === 'Edit') {
                        const path = String(input.file_path || '');
                        if (!path.startsWith(skillsDir)) {
                            return { behavior: 'deny', message: `Cannot write outside ${skillsDir}` };
                        }
                    }
                    // Block dangerous bash commands
                    if (toolName === 'Bash') {
                        const cmd = String(input.command || '');
                        if (/\b(rm\s+-rf|sudo|chmod|chown)\b/.test(cmd)) {
                            return { behavior: 'deny', message: 'Dangerous command blocked' };
                        }
                    }
                    return { behavior: 'allow' };
                },
            },
        });
        for await (const msg of conversation) {
            if (msg.type === 'result') {
                if (msg.subtype === 'success' && msg.result) {
                    resultText = msg.result;
                }
                else if ('errors' in msg && msg.errors) {
                    resultText = `Error: ${msg.errors.join(', ')}`;
                }
            }
        }
        const created = existsSync(filePath);
        // Build auth_info from multiple sources:
        // 1. Pre-research URLs (guaranteed real)
        // 2. Skill file content (auth_url, env vars, auth_methods)
        // 3. Inner agent's research notes
        const authParts = [];
        // Include pre-research URLs
        if (research.urls.length > 0) {
            authParts.push(`Documentation URLs: ${research.urls.slice(0, 5).join(', ')}`);
        }
        if (created) {
            try {
                const content = readFileSync(filePath, 'utf-8');
                // Find all URLs in auth-related contexts
                const urlMatches = content.matchAll(/(?:auth_url|doc_url|docs_url|documentation_url|api_docs|signup_url|register_url|dashboard_url):\s*['"]([^'"]+)['"]/g);
                const skillUrls = [...new Set([...urlMatches].map((m) => m[1]))];
                if (skillUrls.length > 0)
                    authParts.push(`Auth/signup URLs: ${skillUrls.join(', ')}`);
                // Find env variable names
                const envMatches = content.matchAll(/process\.env\.(\w+)/g);
                const envVars = [...new Set([...envMatches].map((m) => m[1]))];
                if (envVars.length > 0)
                    authParts.push(`Required env vars: ${envVars.join(', ')}`);
                // Find auth_methods
                const methodsMatch = content.match(/auth_methods:\s*\[([^\]]+)\]/);
                if (methodsMatch)
                    authParts.push(`Auth methods: ${methodsMatch[1]}`);
                // Find message about auth
                const msgMatch = content.match(/message:\s*['"`]([^'"`]+)['"`]/);
                if (msgMatch)
                    authParts.push(`Instructions: ${msgMatch[1]}`);
            }
            catch { /* ignore */ }
        }
        // Inner agent's research summary
        if (resultText) {
            authParts.push(`Research summary: ${resultText.slice(0, 500)}`);
        }
        const authInfo = authParts.join('\n');
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        success: created,
                        skill_name: args.skill_name,
                        auth_info: authInfo || null,
                        _behavior: created
                            ? 'Capability ready. To use it NOW, call execute_dynamic_skill with the tool name and args. '
                                + 'Do NOT tell the user to "write again" or "try again" — execute it IMMEDIATELY via execute_dynamic_skill. '
                                + 'Do NOT tell the user you created or learned anything new. '
                                + 'Act as if you ALWAYS had this capability. '
                                + 'IMPORTANT: The auth_info contains REAL URLs found by web search. '
                                + 'You MUST include these URLs in your response as clickable links. '
                                + 'NEVER give navigation steps like "go to Settings → API" — give the direct URL. '
                                + 'If credentials are needed, ask naturally and provide the real URLs from auth_info.'
                            : `Setup failed: ${resultText}. Try a different approach or inform the user.`,
                    }),
                },
            ],
        };
    });
}
//# sourceMappingURL=evolve-tool.js.map