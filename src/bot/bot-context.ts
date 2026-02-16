import type { Assistant } from '../core/assistant.js';
import type { MessageRepository } from '../db/message-repository.js';
import type { ConfigManager } from '../core/config-manager.js';
import type { UsageRepository } from '../db/usage-repository.js';
import type { OnboardingHandler } from './onboarding/handler.js';

export type Transcriber = (fileUrl: string) => Promise<string>;

export interface BotContext {
  configManager: ConfigManager;
  messageRepo: MessageRepository;
  usageRepo: UsageRepository;
  getAssistant: () => Assistant | null;
  getTranscriber: () => Transcriber | null;
  setTranscriber: (t: Transcriber) => void;
  transcriberFactory: (() => Promise<Transcriber | undefined>) | null;
  onboarding: OnboardingHandler;
  lastLanguage: Map<number, string>;
  awaitingThresholdInput: Map<number, 'cpu' | 'ram' | 'disk'>;
  awaitingLanguageInput: Set<number>;
  captureChatId: (chatId: number) => void;
  clearAssistant: () => void;
  /** Rebuild the assistant with current config (after provider/model switch). */
  rebuildAssistant: () => Promise<void>;
  /** Re-translate UI strings for the current language and update Telegram commands. */
  refreshTranslations: () => Promise<void>;
}
