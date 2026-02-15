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
export interface DailyTotal {
    date: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    requests: number;
}
export interface ModelBreakdown {
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    requests: number;
}
export declare class UsageRepository {
    private db;
    constructor(db: Database.Database);
    track(model: string, inputTokens: number, outputTokens: number, costUsd: number): void;
    getToday(): UsageSummary;
    getWeek(): UsageSummary;
    getMonth(): UsageSummary;
    getYear(): UsageSummary;
    getByRange(from: string, to: string): UsageSummary;
    getDailyTotals(from: string, to: string): DailyTotal[];
    getModelBreakdown(from: string, to: string): ModelBreakdown[];
    static getDateRange(period: 'today' | 'week' | 'month' | 'year'): {
        from: string;
        to: string;
        label: string;
    };
    static getProviderUrls(provider: string): {
        usage: string;
        billing: string;
        name: string;
    };
    formatReport(provider: string, today: UsageSummary, month: UsageSummary, isOAuth?: boolean): string;
}
export declare function fmtNum(n: number): string;
//# sourceMappingURL=usage-repository.d.ts.map