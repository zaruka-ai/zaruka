import type { Skill, ToolDefinition } from '../../core/types.js';

// Gmail skill — phase 2 placeholder
export class GmailSkill implements Skill {
  name = 'gmail';
  description = 'Email subscription tracking (coming soon)';
  tools: ToolDefinition[] = [];

  async execute(_toolName: string, _params: Record<string, unknown>): Promise<string> {
    return JSON.stringify({ error: 'Gmail skill is not yet implemented' });
  }
}
