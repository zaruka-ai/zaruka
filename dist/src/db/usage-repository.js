const PROVIDER_URLS = {
    anthropic: {
        name: 'Anthropic',
        usage: 'https://console.anthropic.com/settings/usage',
        billing: 'https://console.anthropic.com/settings/billing',
    },
    openai: {
        name: 'OpenAI',
        usage: 'https://platform.openai.com/usage',
        billing: 'https://platform.openai.com/settings/organization/billing/overview',
    },
    'openai-compatible': {
        name: 'OpenAI-Compatible',
        usage: '',
        billing: '',
    },
};
export class UsageRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    track(model, inputTokens, outputTokens, costUsd) {
        const today = new Date().toISOString().slice(0, 10);
        this.db.prepare(`
      INSERT INTO api_usage (date, model, input_tokens, output_tokens, cost_usd, requests)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(date, model) DO UPDATE SET
        input_tokens = input_tokens + excluded.input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        cost_usd = cost_usd + excluded.cost_usd,
        requests = requests + 1
    `).run(today, model, inputTokens, outputTokens, costUsd);
    }
    getToday() {
        const today = new Date().toISOString().slice(0, 10);
        return this.getByRange(today, today);
    }
    getMonth() {
        const now = new Date();
        const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const to = now.toISOString().slice(0, 10);
        return this.getByRange(from, to);
    }
    getByRange(from, to) {
        const rows = this.db.prepare(`
      SELECT date, model, input_tokens, output_tokens, cost_usd, requests
      FROM api_usage
      WHERE date >= ? AND date <= ?
      ORDER BY date DESC
    `).all(from, to);
        let input_tokens = 0;
        let output_tokens = 0;
        let cost_usd = 0;
        let requests = 0;
        for (const r of rows) {
            input_tokens += r.input_tokens;
            output_tokens += r.output_tokens;
            cost_usd += r.cost_usd;
            requests += r.requests;
        }
        return {
            input_tokens,
            output_tokens,
            total_tokens: input_tokens + output_tokens,
            cost_usd: Math.round(cost_usd * 10000) / 10000,
            requests,
            breakdown: rows,
        };
    }
    static getProviderUrls(provider) {
        return PROVIDER_URLS[provider] || PROVIDER_URLS['openai-compatible'];
    }
    formatReport(provider, today, month, isOAuth) {
        const urls = UsageRepository.getProviderUrls(provider);
        const lines = [
            '📈 Usage Statistics',
            '',
            `Today: ${today.requests} requests`,
            `  Tokens: ${fmtNum(today.input_tokens)} in / ${fmtNum(today.output_tokens)} out`,
        ];
        // Only show cost for API mode (not OAuth/subscription)
        if (!isOAuth) {
            lines.push(`  Cost: ~$${today.cost_usd.toFixed(4)}`);
        }
        lines.push('');
        lines.push(`This month: ${month.requests} requests`);
        lines.push(`  Tokens: ${fmtNum(month.input_tokens)} in / ${fmtNum(month.output_tokens)} out`);
        if (!isOAuth) {
            lines.push(`  Cost: ~$${month.cost_usd.toFixed(4)}`);
        }
        // For OAuth users, show subscription info
        if (isOAuth && provider === 'anthropic') {
            lines.push('', '💡 You\'re using Claude via subscription (usage included)');
            lines.push('📊 View usage: https://claude.ai/settings/usage');
        }
        else {
            // For API users, show dashboard links
            if (urls.usage) {
                lines.push('', `📊 Dashboard: ${urls.usage}`);
            }
            if (urls.billing) {
                lines.push(`💳 Billing: ${urls.billing}`);
            }
        }
        return lines.join('\n');
    }
}
function fmtNum(n) {
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}
//# sourceMappingURL=usage-repository.js.map