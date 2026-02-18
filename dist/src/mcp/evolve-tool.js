import { z } from 'zod/v4';
import { tool, generateText, stepCountIs } from 'ai';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBestModel } from '../ai/model-factory.js';
const SKILL_TEMPLATE = `
import { z } from 'zod/v4';
import { tool } from 'ai';

export const tools = {
  TOOL_NAME: tool({
    description: 'TOOL_DESCRIPTION',
    inputSchema: z.object({
      // define input schema with zod (e.g. query: z.string())
    }),
    execute: async (args) => {
      // implement the tool logic using fetch() for HTTP requests
      return JSON.stringify({ result: 'TODO' });
    },
  }),
};
`.trim();
/**
 * Quick web search via DuckDuckGo HTML to find real URLs before spawning the inner agent.
 */
async function preResearch(description) {
    const urls = [];
    const snippets = [];
    const pages = [];
    const searchQuery = description.slice(0, 100) + ' API documentation authorization';
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    // Try Brave first (fast), fall back to DuckDuckGo
    let foundUrls = false;
    const searchFns = [];
    if (process.env.BRAVE_API_KEY) {
        searchFns.push(async () => {
            const bUrl = new URL('https://api.search.brave.com/res/v1/web/search');
            bUrl.searchParams.set('q', searchQuery);
            bUrl.searchParams.set('count', '10');
            let lastErr = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                if (attempt > 0)
                    await new Promise((r) => setTimeout(r, attempt * 1500));
                const resp = await fetch(bUrl.toString(), {
                    headers: { 'Accept': 'application/json', 'X-Subscription-Token': process.env.BRAVE_API_KEY },
                    signal: AbortSignal.timeout(10000),
                });
                if (resp.status === 429) {
                    lastErr = new Error('Brave API: 429');
                    continue;
                }
                if (!resp.ok)
                    throw new Error(`Brave API: ${resp.status}`);
                const data = await resp.json();
                for (const r of (data.web?.results ?? []).slice(0, 10)) {
                    urls.push(r.url);
                    if (r.description && r.description.length > 20)
                        snippets.push(r.description);
                }
                return;
            }
            throw lastErr ?? new Error('Brave API: max retries');
        });
    }
    searchFns.push(async () => {
        const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
        const html = await resp.text();
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
        const snippetMatches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\//g)];
        for (const m of snippetMatches.slice(0, 5)) {
            const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (text.length > 20)
                snippets.push(text);
        }
    });
    for (const searchFn of searchFns) {
        try {
            await searchFn();
            if (urls.length > 0) {
                foundUrls = true;
                break;
            }
        }
        catch (err) {
            console.log(`Pre-research provider failed: ${err instanceof Error ? err.message : err}`);
        }
    }
    if (!foundUrls)
        console.log('Pre-research: all search providers failed');
    for (const url of urls.slice(0, 3)) {
        try {
            const resp = await fetch(url, {
                headers: { 'User-Agent': UA },
                signal: AbortSignal.timeout(10000),
                redirect: 'follow',
            });
            if (!resp.ok)
                continue;
            const contentType = resp.headers.get('content-type') || '';
            if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json'))
                continue;
            const body = await resp.text();
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
/** Track in-progress evolve_skill calls to prevent duplicates. */
const evolvingSkills = new Set();
/** Create the evolve_skill tool with Vercel AI SDK inner agent. */
export function createEvolveTool(skillsDir, aiConfig) {
    return tool({
        description: 'SELF-EVOLUTION: Create a new skill that integrates an external API or automates a task. Call this when the user needs a capability that requires an external service (e.g. currency conversion, stock data, weather from a specific provider). DO NOT call this for capabilities that should be native to the AI model (image generation, audio, video) — for those, tell the user to switch models via /settings instead. The new skill will be available on the next message.',
        inputSchema: z.object({
            skill_name: z.string().describe('Short snake_case name for the skill (e.g. "currency_converter", "translator")'),
            description: z.string().describe('Detailed description of what the skill should do, including expected inputs and outputs'),
        }),
        execute: async (args) => {
            // Prevent duplicate parallel calls for the same skill
            if (evolvingSkills.has(args.skill_name)) {
                return JSON.stringify({
                    success: false,
                    error: 'in_progress',
                    message: `Skill "${args.skill_name}" is already being created. Wait for it to finish, then use execute_dynamic_skill to call it.`,
                });
            }
            // Reject skills for native model capabilities — enforce in code, not just prompts
            const nativeKeywords = /\b(image.generat|generat.*image|dall.?e|midjourney|stable.diffusion|text.to.image|text.to.speech|text.to.video|text.to.audio|speech.synth|voice.generat|video.generat|audio.generat|tts\b|stt\b)/i;
            const combined = `${args.skill_name} ${args.description}`;
            if (nativeKeywords.test(combined)) {
                console.log(`evolve_skill: rejected "${args.skill_name}" — native model capability`);
                return JSON.stringify({
                    success: false,
                    error: 'native_capability',
                    message: 'This capability (image/audio/video generation) should be handled natively by the AI model, not via a third-party skill. '
                        + 'Tell the user that the current model does not support this and suggest switching to a model that does (e.g. GPT-4o, Gemini) via /settings. '
                        + 'As an alternative, offer several third-party services with pricing comparison and let the user choose.',
                });
            }
            evolvingSkills.add(args.skill_name);
            try {
                if (!existsSync(skillsDir)) {
                    mkdirSync(skillsDir, { recursive: true });
                }
                const fileName = `${args.skill_name}.js`;
                const filePath = resolve(skillsDir, fileName);
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
                        'Use web_fetch to read more from these URLs if you need additional details.',
                        'IMPORTANT: Use these real URLs in your auth_url fields, NOT made-up ones.',
                    ].join('\n')
                    : '';
                const prompt = [
                    `Create a skill file at ${filePath} that: ${args.description}`,
                    researchContext,
                    '',
                    '=== STEP 1: ANALYZE DOCUMENTATION ===',
                    research.pages.length > 0
                        ? 'Documentation has already been fetched above. Read it carefully and extract:'
                        : 'Use web_fetch to read the URLs found above (or use web_search if no URLs found). Extract:',
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
                    '- Just standard ES module JavaScript with import/export',
                    '',
                    'Requirements:',
                    '- Import z from "zod/v4" and tool from "ai"',
                    '- Export a `tools` object (not array) where keys are tool names and values are tool() calls',
                    '- Each tool\'s execute returns a JSON string',
                    '- Use fetch() for HTTP requests (no extra deps)',
                    `- Write the file to: ${filePath}`,
                    '',
                    'Auth handling:',
                    '- Read credentials from env variables (e.g. process.env.SERVICE_NAME_API_KEY)',
                    '- When credentials are missing, return JSON with:',
                    '  { error: "auth_required", auth_url: "REAL URL from documentation", auth_methods: [...], message: "clear instructions" }',
                    '- auth_url MUST come from the documentation found above — NEVER invent URLs',
                    '',
                    '=== STEP 3: SUMMARY ===',
                    'Output a brief summary:',
                    '- What API documentation you found (with real URLs)',
                    '- What auth methods are available',
                    '- What env variables the user needs to set',
                    '- Direct URL where the user can get credentials',
                ].join('\n');
                // Inner agent tools: write_file, read_file, web_fetch, web_search
                const innerTools = {
                    write_file: tool({
                        description: 'Write content to a file',
                        inputSchema: z.object({
                            path: z.string().describe('File path'),
                            content: z.string().describe('File content'),
                        }),
                        execute: async (a) => {
                            if (!a.path.startsWith(skillsDir)) {
                                return JSON.stringify({ error: `Cannot write outside ${skillsDir}` });
                            }
                            writeFileSync(a.path, a.content, 'utf-8');
                            return JSON.stringify({ success: true, path: a.path });
                        },
                    }),
                    read_file: tool({
                        description: 'Read content of a file',
                        inputSchema: z.object({ path: z.string().describe('File path') }),
                        execute: async (a) => {
                            if (!existsSync(a.path))
                                return JSON.stringify({ error: 'File not found' });
                            return readFileSync(a.path, 'utf-8');
                        },
                    }),
                    web_fetch: tool({
                        description: 'Fetch a URL and return its text content (HTML stripped to plain text)',
                        inputSchema: z.object({ url: z.string().describe('URL to fetch') }),
                        execute: async (a) => {
                            try {
                                const resp = await fetch(a.url, {
                                    headers: { 'User-Agent': 'Mozilla/5.0' },
                                    signal: AbortSignal.timeout(15000),
                                    redirect: 'follow',
                                });
                                if (!resp.ok)
                                    return JSON.stringify({ error: `HTTP ${resp.status}` });
                                const body = await resp.text();
                                const text = body
                                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                                    .replace(/<[^>]+>/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim()
                                    .slice(0, 5000);
                                return text;
                            }
                            catch (err) {
                                return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
                            }
                        },
                    }),
                    web_search: tool({
                        description: 'Search the web and return URLs and snippets',
                        inputSchema: z.object({ query: z.string().describe('Search query') }),
                        execute: async (a) => {
                            const r = await preResearch(a.query);
                            return JSON.stringify({ urls: r.urls, snippets: r.snippets });
                        },
                    }),
                };
                let resultText = '';
                try {
                    const model = await createBestModel(aiConfig);
                    const result = await generateText({
                        model,
                        system: [
                            `You are a skill developer for the Zaruka AI assistant. You create JavaScript skill files in ${skillsDir}.`,
                            '',
                            'YOUR #1 RULE: Use ONLY real URLs from the pre-research results or from web_fetch/web_search.',
                            'NEVER invent or guess URLs. If you cannot find real documentation, include that in your summary.',
                        ].join('\n'),
                        prompt,
                        tools: innerTools,
                        stopWhen: stepCountIs(6),
                    });
                    resultText = result.text;
                }
                catch (err) {
                    resultText = `Error: ${err instanceof Error ? err.message : String(err)}`;
                }
                const created = existsSync(filePath);
                // Build auth_info from multiple sources
                const authParts = [];
                if (research.urls.length > 0) {
                    authParts.push(`Documentation URLs: ${research.urls.slice(0, 5).join(', ')}`);
                }
                if (created) {
                    try {
                        const content = readFileSync(filePath, 'utf-8');
                        const urlMatches = content.matchAll(/(?:auth_url|doc_url|docs_url|documentation_url|api_docs|signup_url|register_url|dashboard_url):\s*['"]([^'"]+)['"]/g);
                        const skillUrls = [...new Set([...urlMatches].map((m) => m[1]))];
                        if (skillUrls.length > 0)
                            authParts.push(`Auth/signup URLs: ${skillUrls.join(', ')}`);
                        const envMatches = content.matchAll(/process\.env\.(\w+)/g);
                        const envVars = [...new Set([...envMatches].map((m) => m[1]))];
                        if (envVars.length > 0)
                            authParts.push(`Required env vars: ${envVars.join(', ')}`);
                        const methodsMatch = content.match(/auth_methods:\s*\[([^\]]+)\]/);
                        if (methodsMatch)
                            authParts.push(`Auth methods: ${methodsMatch[1]}`);
                        const msgMatch = content.match(/message:\s*['"`]([^'"`]+)['"`]/);
                        if (msgMatch)
                            authParts.push(`Instructions: ${msgMatch[1]}`);
                    }
                    catch { /* ignore */ }
                }
                if (resultText) {
                    authParts.push(`Research summary: ${resultText.slice(0, 500)}`);
                }
                const authInfo = authParts.join('\n');
                return JSON.stringify({
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
                });
            }
            finally {
                evolvingSkills.delete(args.skill_name);
            }
        },
    });
}
//# sourceMappingURL=evolve-tool.js.map