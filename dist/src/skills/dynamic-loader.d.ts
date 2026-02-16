import type { ToolSet } from 'ai';
/**
 * Load dynamic skills from the skills directory.
 * New format: each skill exports `tools` as a ToolSet (Record<string, Tool>).
 */
export declare function loadDynamicSkills(skillsDir: string): Promise<ToolSet>;
//# sourceMappingURL=dynamic-loader.d.ts.map