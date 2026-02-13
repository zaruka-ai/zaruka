import { Telegraf } from 'telegraf';
import type { Assistant } from '../core/assistant.js';

export class TelegramBot {
  private bot: Telegraf;
  private assistant: Assistant;

  constructor(token: string, assistant: Assistant) {
    this.bot = new Telegraf(token);
    this.assistant = assistant;

    this.bot.on('text', async (ctx) => {
      const userMessage = ctx.message.text;
      try {
        await ctx.sendChatAction('typing');
        const response = await this.assistant.process(userMessage);
        if (response) {
          // Split long messages (Telegram limit is 4096 chars)
          const chunks = this.splitMessage(response, 4000);
          for (const chunk of chunks) {
            await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(() => {
              // Retry without markdown if parsing fails
              return ctx.reply(chunk);
            });
          }
        }
      } catch (err) {
        console.error('Error processing message:', err);
        await ctx.reply('Sorry, something went wrong. Please try again.');
      }
    });

    this.bot.catch((err) => {
      console.error('Telegraf error:', err);
    });
  }

  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt === -1 || splitAt < maxLength / 2) {
        splitAt = maxLength;
      }
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }
    return chunks;
  }

  async start(): Promise<void> {
    console.log('Telegram bot starting (polling mode)...');
    await this.bot.launch();
    console.log('Telegram bot is running.');

    const shutdown = () => {
      this.bot.stop('SIGINT');
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }

  stop(): void {
    this.bot.stop();
  }
}
