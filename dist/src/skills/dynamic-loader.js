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
    // Create package.json with "type": "module" for ESM support
    const pkgPath = join(skillsDir, 'package.json');
    if (!existsSync(pkgPath)) {
        writeFileSync(pkgPath, JSON.stringify({ type: 'module' }, null, 2));
    }
    // Symlink node_modules so skills can import zod, SDK, etc.
    const targetLink = join(skillsDir, 'node_modules');
    // Find zaruka's node_modules from this file's location
    // In compiled: dist/skills/dynamic-loader.js → ../../node_modules
    // In dev:      src/skills/dynamic-loader.ts  → ../../node_modules
    const thisFile = fileURLToPath(import.meta.url);
    const projectRoot = join(dirname(thisFile), '..', '..');
    const nodeModules = join(projectRoot, 'node_modules');
    if (!existsSync(nodeModules))
        return;
    // Remove stale symlink if it points to the wrong location
    try {
        const current = readlinkSync(targetLink);
        if (current !== nodeModules) {
            unlinkSync(targetLink);
        }
        else {
            return; // Already correct
        }
    }
    catch {
        // Not a symlink or doesn't exist — proceed to create
    }
    try {
        symlinkSync(nodeModules, targetLink, 'dir');
        console.log('Skills: linked node_modules');
    }
    catch {
        // Ignore — may already exist or lack permissions
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadDynamicSkills(skillsDir) {
    ensureSkillsDeps(skillsDir);
    if (!existsSync(skillsDir)) {
        return [];
    }
    const files = readdirSync(skillsDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = [];
    const toolNames = new Set();
    for (const file of files) {
        try {
            const fullPath = join(skillsDir, file);
            const mod = await import(pathToFileURL(fullPath).href);
            let loadedCount = 0;
            // Each skill file must export `tools` — an array of SdkMcpToolDefinition
            if (Array.isArray(mod.tools)) {
                for (const t of mod.tools) {
                    if (t && typeof t.name === 'string' && typeof t.handler === 'function') {
                        if (toolNames.has(t.name)) {
                            console.warn(`Skills: skipping duplicate tool "${t.name}" from ${file}`);
                            continue;
                        }
                        tools.push(t);
                        toolNames.add(t.name);
                        loadedCount++;
                    }
                }
            }
            else if (mod.default && Array.isArray(mod.default)) {
                for (const t of mod.default) {
                    if (t && typeof t.name === 'string' && typeof t.handler === 'function') {
                        if (toolNames.has(t.name)) {
                            console.warn(`Skills: skipping duplicate tool "${t.name}" from ${file}`);
                            continue;
                        }
                        tools.push(t);
                        toolNames.add(t.name);
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