import { z } from 'zod/v4';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { MessageRepository } from '../db/message-repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createHistoryTools(messageRepo: MessageRepository): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      'search_conversation_history',
      'Search through past conversation history. Use this when the user asks about previous conversations, '
      + 'e.g. "what did I ask about last week?", "find our conversation about X", "what did you recommend for Y?"',
      {
        query: z.string().describe('Search text to find in past messages'),
        limit: z.number().optional().describe('Max results to return (default 10)'),
      },
      async (args) => {
        const results = messageRepo.searchAll(args.query, args.limit || 10);

        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ found: 0, message: 'No messages found matching the query.' }) }],
          };
        }

        const formatted = results.map((m) => ({
          role: m.role,
          text: m.text.length > 300 ? m.text.slice(0, 300) + '...' : m.text,
          date: m.created_at,
        }));

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ found: results.length, messages: formatted }) }],
        };
      },
    ),

    tool(
      'get_conversation_stats',
      'Get statistics about conversation history: total messages, date range, etc. '
      + 'Use when user asks "how many messages have we exchanged?", "when did we first talk?", etc.',
      {
        chat_id: z.number().optional().describe('Chat ID (omit for overall stats)'),
      },
      async (args) => {
        if (args.chat_id) {
          const stats = messageRepo.getStats(args.chat_id);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(stats) }],
          };
        }

        // Overall stats
        const disk = messageRepo.getDiskUsage();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ ...disk, note: 'Provide chat_id for per-chat stats' }) }],
        };
      },
    ),
  ];
}
