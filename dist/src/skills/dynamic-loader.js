import { existsSync, readdirSync, symlinkSync, mkdirSync, writeFileSync, readlinkSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
/**
 * Ensure the skills directory can resolve zaruka's node_modules
 * (symlink + package.json with "type": "module")
 */
function ensureSkillsDeps(skillsDir) {
    if (!existsSync(skillsDir)) {
        mkdirSync(skillsDir, { recursive: true });
    }
    const pkgPath = join(skillsDir, 'package.json');
    if (!existsSync(pkgPath)) {
        writeFileSync(pkgPath, JSON.stringify({ type: 'module' }, null, 2));
    }
    const targetLink = join(skillsDir, 'node_modules');
    const thisFile = fileURLToPath(import.meta.url);
    const projectRoot = join(dirname(thisFile), '..', '..');
    const nodeModules = join(projectRoot, 'node_modules');
    if (!existsSync(nodeModules))
        return;
    try {
        const current = readlinkSync(targetLink);
        if (current !== nodeModules) {
            unlinkSync(targetLink);
        }
        else {
            return;
        }
    }
    catch {
        // Not a symlink or doesn't exist
    }
    try {
        symlinkSync(nodeModules, targetLink, 'dir');
        console.log('Skills: linked node_modules');
    }
    catch {
        // Ignore
    }
}
/**
 * Load dynamic skills from the skills directory.
 * New format: each skill exports `tools` as a ToolSet (Record<string, Tool>).
 */
export async function loadDynamicSkills(skillsDir) {
    ensureSkillsDeps(skillsDir);
    if (!existsSync(skillsDir)) {
        return {};
    }
    const files = readdirSync(skillsDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
    const tools = {};
    for (const file of files) {
        try {
            const fullPath = join(skillsDir, file);
            const mod = await import(pathToFileURL(fullPath).href);
            let loadedCount = 0;
            if (mod.tools && typeof mod.tools === 'object' && !Array.isArray(mod.tools)) {
                // New format: tools is a ToolSet
                for (const [name, t] of Object.entries(mod.tools)) {
                    if (name in tools) {
                        console.warn(`Skills: skipping duplicate tool "${name}" from ${file}`);
                        continue;
                    }
                    tools[name] = t;
                    loadedCount++;
                }
            }
            else if (Array.isArray(mod.tools) || Array.isArray(mod.default)) {
                // Legacy format: tools is an array of { name, handler } (old Claude Agent SDK format)
                const toolsList = Array.isArray(mod.tools) ? mod.tools : mod.default;
                for (const t of toolsList) {
                    if (t && typeof t.name === 'string' && typeof t.handler === 'function') {
                        if (t.name in tools) {
                            console.warn(`Skills: skipping duplicate tool "${t.name}" from ${file}`);
                            continue;
                        }
                        // Wrap legacy tool into compatible shape for execute_dynamic_skill
                        tools[t.name] = { execute: t.handler };
                        loadedCount++;
                    }
                }
            }
            if (loadedCount > 0) {
                console.log(`Skills: loaded ${file}`);
            }
        }
        catch (err) {
            console.error(`Skills: failed to load ${file}:`, err instanceof Error ? err.message : err);
        }
    }
    return tools;
}
//# sourceMappingURL=dynamic-loader.js.map