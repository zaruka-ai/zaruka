const MAX_TOOL_ROUNDS = 10;
export class Assistant {
    provider;
    registry;
    sdkRunner;
    systemPrompt;
    constructor(opts) {
        this.provider = opts.provider ?? null;
        this.registry = opts.registry ?? null;
        this.sdkRunner = opts.sdkRunner ?? null;
        this.systemPrompt = [
            'You are Zaruka, a self-evolving personal AI assistant.',
            `User timezone: ${opts.timezone}. Current time: ${new Date().toLocaleString('en-US', { timeZone: opts.timezone })}.`,
            'Be concise and friendly. Respond in the same language the user writes in.',
            'Use the available tools for tasks, weather, etc.',
            'When creating tasks with due dates, parse natural language dates relative to the current date.',
            'If the user asks for something you cannot do with existing tools, try to find a creative solution or suggest alternatives.',
        ].join('\n');
    }
    async process(userMessage, history) {
        // Anthropic path: delegate to AgentSdkRunner (handles tool loop internally)
        if (this.sdkRunner) {
            return this.sdkRunner.process(userMessage, history);
        }
        // OpenAI path: manual tool loop via SkillRegistry
        if (!this.provider || !this.registry) {
            return 'Assistant is not configured.';
        }
        const messages = [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: userMessage },
        ];
        const tools = this.registry.getAllTools();
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const response = await this.provider.chat(messages, tools.length > 0 ? tools : undefined);
            if (!response.toolCalls || response.toolCalls.length === 0) {
                return response.text ?? '';
            }
            const toolResults = [];
            for (const call of response.toolCalls) {
                const result = await this.registry.executeTool(call.name, call.params);
                toolResults.push(`[${call.name}]: ${result}`);
            }
            if (response.text) {
                messages.push({ role: 'assistant', content: response.text });
            }
            messages.push({
                role: 'assistant',
                content: `Tool calls: ${response.toolCalls.map((c) => c.name).join(', ')}`,
            });
            messages.push({
                role: 'user',
                content: `Tool results:\n${toolResults.join('\n')}`,
            });
        }
        return 'I reached the maximum number of tool call rounds. Please try rephrasing your request.';
    }
}
//# sourceMappingURL=assistant.js.map