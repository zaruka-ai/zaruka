import { tool } from 'ai';
import { z } from 'zod/v4';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export function createSkillManagementTools(skillsDir, rebuildRef) {
    return {
        list_skills: tool({
            description: 'List all installed dynamic skills and their tools.',
            inputSchema: z.object({}),
            execute: async () => {
                if (!existsSync(skillsDir)) {
                    return JSON.stringify({ skills: [], message: 'No skills installed.' });
                }
                const files = readdirSync(skillsDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
                if (files.length === 0) {
                    return JSON.stringify({ skills: [], message: 'No skills installed.' });
                }
                const skills = [];
                for (const file of files) {
                    try {
                        const fullPath = join(skillsDir, file);
                        const mod = await import(pathToFileURL(fullPath).href + `?t=${Date.now()}`);
                        const toolsMap = mod.tools;
                        if (toolsMap && typeof toolsMap === 'object' && !Array.isArray(toolsMap)) {
                            const toolEntries = Object.entries(toolsMap).map(([name, t]) => ({
                                name,
                                description: (typeof t?.description === 'string' ? t.description : '') || '(no description)',
                            }));
                            skills.push({ file, tools: toolEntries });
                        }
                    }
                    catch {
                        skills.push({ file, tools: [{ name: '(failed to load)', description: 'Error loading skill file' }] });
                    }
                }
                return JSON.stringify({ skills });
            },
        }),
        remove_skill: tool({
            description: 'Remove an installed dynamic skill by file name.',
            inputSchema: z.object({
                name: z.string().describe('Skill file name (e.g. "weather.js" or "weather")'),
            }),
            execute: async (args) => {
                let fileName = args.name;
                if (!fileName.endsWith('.js') && !fileName.endsWith('.mjs')) {
                    fileName += '.js';
                }
                const fullPath = join(skillsDir, fileName);
                if (!existsSync(fullPath)) {
                    return JSON.stringify({ error: `Skill file "${fileName}" not found.` });
                }
                try {
                    unlinkSync(fullPath);
                }
                catch (err) {
                    return JSON.stringify({ error: `Failed to delete "${fileName}": ${err instanceof Error ? err.message : err}` });
                }
                try {
                    if (rebuildRef.current)
                        await rebuildRef.current();
                }
                catch { /* non-fatal */ }
                return JSON.stringify({ success: true, message: `Skill "${fileName}" removed.` });
            },
        }),
    };
}
//# sourceMappingURL=skill-tools.js.map