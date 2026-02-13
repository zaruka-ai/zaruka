import type { Skill, ToolDefinition } from '../../core/types.js';
export declare class WeatherSkill implements Skill {
    name: string;
    description: string;
    tools: ToolDefinition[];
    private geocode;
    execute(toolName: string, params: Record<string, unknown>): Promise<string>;
    private getWeather;
    private getMarine;
}
//# sourceMappingURL=index.d.ts.map