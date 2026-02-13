import type Database from 'better-sqlite3';
export interface UsageRecord {
    date: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    requests: number;
}
export interface UsageSummary {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd: number;
    requests: number;
    breakdown: UsageRecord[];
}
export declare class UsageRepository {
    private db;
    constructor(db: Database.Database);
    track(model: string, inputTokens: number, outputTokens: number, costUsd: number): void;
    getToday(): UsageSummary;
    getMonth(): UsageSummary;
    getByRange(from: string, to: string): UsageSummary;
    static getProviderUrls(provider: string): {
        usage: string;
        billing: string;
        name: string;
    };
    formatReport(provider: string, today: UsageSummary, month: UsageSummary, isOAuth?: boolean): string;
}
//# sourceMappingURL=usage-repository.d.ts.map