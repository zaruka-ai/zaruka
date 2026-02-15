/** Data shape matching ccusage's DailyUsage */
export interface ChartDailyData {
    date: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    cost: number;
}
interface ChartOptions {
    title?: string;
    mode?: 'tokens' | 'cost';
    period?: 'today' | 'week' | 'month' | 'year';
    width?: number;
    height?: number;
}
export declare function generateUsageChart(daily: ChartDailyData[], options?: ChartOptions): Promise<Buffer>;
export {};
//# sourceMappingURL=usage-chart.d.ts.map