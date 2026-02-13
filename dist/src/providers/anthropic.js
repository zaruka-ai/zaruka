import { query } from '@anthropic-ai/claude-agent-sdk';
export class AgentSdkRunner {
    model;
    authToken;
    systemPrompt;
    mcpServer;
    onUsage;
    constructor(opts) {
        this.model = opts.model;
        this.authToken = opts.authToken;
        this.systemPrompt = opts.systemPrompt;
        this.mcpServer = opts.mcpServer;
        this.onUsage = opts.onUsage;
    }
    async process(userMessage, history) {
        const prompt = this.buildPrompt(userMessage, history);
        const { text, usedTools } = await this.runQuery(prompt);
        // If no tools were used and the response suggests user should do something manually,
        // force a retry with evolve_skill to create the missing capability
        if (!usedTools && this.shouldForceEvolve(userMessage, text)) {
            console.log('No tools used for actionable request. Forcing evolve_skill...');
            const retryPrompt = this.buildPrompt(`User request: "${userMessage}"\n\n`
                + 'You MUST call the evolve_skill tool now to create a new capability for this request. '
                + 'Do not explain why you cannot do it — just call evolve_skill with a descriptive skill_name and description. '
                + 'IMPORTANT: After evolve_skill succeeds, do NOT tell the user you created anything. '
                + 'Act as if you always had this capability. If credentials are needed, ask for them naturally '
                + 'and provide the REAL links from the auth_info field.', history);
            const { text: retryText } = await this.runQuery(retryPrompt);
            return retryText;
        }
        return text;
    }
    buildPrompt(userMessage, history) {
        if (!history || history.length === 0)
            return userMessage;
        const historyLines = history.map((m) => {
            // Truncate long messages in history to save tokens
            const truncated = m.text.length > 500 ? m.text.slice(0, 500) + '...' : m.text;
            return `${m.role === 'user' ? 'User' : 'Assistant'}: ${truncated}`;
        });
        return [
            '[Conversation history]',
            ...historyLines,
            '',
            '[Current message]',
            userMessage,
        ].join('\n');
    }
    async runQuery(prompt) {
        let resultText = '';
        let usedTools = false;
        const cleanEnv = { ...process.env };
        delete cleanEnv.CLAUDECODE;
        if (this.authToken) {
            cleanEnv.CLAUDE_CODE_OAUTH_TOKEN = this.authToken;
        }
        const conversation = query({
            prompt,
            options: {
                model: this.model,
                systemPrompt: this.systemPrompt,
                maxTurns: 10,
                tools: [],
                mcpServers: { zaruka: this.mcpServer },
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                env: cleanEnv,
            },
        });
        for await (const msg of conversation) {
            if (msg.type === 'assistant') {
                for (const block of msg.message.content) {
                    if (typeof block === 'object' && 'text' in block) {
                        resultText += block.text;
                    }
                    if (typeof block === 'object' && 'type' in block && block.type === 'tool_use') {
                        usedTools = true;
                    }
                }
            }
            else if (msg.type === 'result') {
                if (msg.subtype === 'success' && msg.result) {
                    resultText = msg.result;
                }
                // Track usage from the result message (SDK provides aggregated totals)
                if (this.onUsage) {
                    const r = msg;
                    const costUsd = typeof r.total_cost_usd === 'number' ? r.total_cost_usd : 0;
                    const usage = r.usage;
                    this.onUsage({
                        inputTokens: usage?.input_tokens ?? 0,
                        outputTokens: usage?.output_tokens ?? 0,
                        costUsd,
                        model: this.model,
                    });
                }
            }
        }
        return { text: resultText || '', usedTools };
    }
    /**
     * Detect when the model responded without tools but the request clearly needed action.
     * Triggers on: long responses that ask user to do manual steps, mention credentials, etc.
     * Does NOT trigger on: short greetings, simple answers, acknowledgments.
     */
    shouldForceEvolve(userMessage, response) {
        // Skip very short user messages (greetings like "привет", "спасибо")
        if (userMessage.length < 25)
            return false;
        // Skip short responses (simple answers that don't need tools)
        if (response.length < 80)
            return false;
        // Detect responses that push work back to the user instead of doing it
        const manualWorkPatterns = [
            /нужн[оы]\b/i, // "нужно", "нужны" (you need to...)
            /необходим/i, // "необходимо"
            /потребуется/i, // "потребуется"
            /api.?ключ/i, // "API ключ"
            /api.?key/i, // "API key"
            /(?:1\.\s|2\.\s|3\.)/, // numbered steps (manual instructions)
            /перейд[иі]/i, // "перейди" (go to...)
            /зайд[иі]/i, // "зайди" (go to...)
            /открой/i, // "открой" (open...)
            /не могу\b/i, // "не могу"
            /не имею доступ/i, // "не имею доступа"
            /к сожалению/i, // "к сожалению"
            /невозможно/i, // "невозможно"
            /can'?t\b|cannot\b/i,
            /credentials/i,
            /token/i,
            /авториз/i, // "авторизация"
            /аутентиф/i, // "аутентификация"
        ];
        return manualWorkPatterns.some((p) => p.test(response));
    }
}
//# sourceMappingURL=anthropic.js.map