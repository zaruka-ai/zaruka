import { z } from 'zod/v4';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Dynamically load a skill tool from the skills directory and execute it.
 * This allows newly created skills (from evolve_skill) to be used immediately
 * without restarting the bot.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createExecuteSkillTool(skillsDir: string): SdkMcpToolDefinition<any> {
  return tool(
    'execute_dynamic_skill',
    'Execute a dynamically created skill tool by name. Use this to call skills that were just created by evolve_skill, '
    + 'or to retry a failed skill call. This loads the latest version of the skill from disk — '
    + 'so if evolve_skill just updated a skill, this will use the updated version.',
    {
      tool_name: z.string().describe('Name of the tool to execute (e.g. "get_freedom_finance_positions")'),
      args: z.record(z.string(), z.unknown()).optional().describe('Arguments to pass to the tool (key-value pairs)'),
    },
    async (input) => {
      if (!existsSync(skillsDir)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No skills directory found' }) }],
        };
      }

      const files = readdirSync(skillsDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));

      // Search all skill files for the requested tool
      for (const file of files) {
        try {
          const fullPath = join(skillsDir, file);
          // Use cache-busting query to always get fresh version
          const mod = await import(pathToFileURL(fullPath).href + `?t=${Date.now()}`);

          const toolsList = Array.isArray(mod.tools) ? mod.tools : (Array.isArray(mod.default) ? mod.default : []);

          for (const t of toolsList) {
            if (t && t.name === input.tool_name && typeof t.handler === 'function') {
              // Execute the tool handler with the provided args
              const result = await t.handler(input.args || {});
              return result;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // If this file failed to load, try the next one
          console.error(`execute_dynamic_skill: error loading ${file}:`, msg);
          continue;
        }
      }

      // Tool not found — list available tools
      const available: string[] = [];
      for (const file of files) {
        try {
          const fullPath = join(skillsDir, file);
          const mod = await import(pathToFileURL(fullPath).href + `?t=${Date.now()}`);
          const toolsList = Array.isArray(mod.tools) ? mod.tools : (Array.isArray(mod.default) ? mod.default : []);
          for (const t of toolsList) {
            if (t?.name) available.push(t.name);
          }
        } catch { /* skip broken files */ }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: `Tool "${input.tool_name}" not found`,
            available_tools: available,
          }),
        }],
      };
    },
  );
}
