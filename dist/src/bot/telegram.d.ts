import type { Assistant } from '../core/assistant.js';
import type { MessageRepository } from '../db/message-repository.js';
import type { ConfigManager } from '../core/config-manager.js';
import type { UsageRepository } from '../db/usage-repository.js';
import type { TaskRepository } from '../db/repository.js';
export type { Transcriber } from './bot-context.js';
export declare class TelegramBot {
    private bot;
    private assistant;
    private configManager;
    private onboarding;
    constructor(token: string, assistant: Assistant | null, messageRepo: MessageRepository, configManager: ConfigManager, usageRepo: UsageRepository, taskRepo: TaskRepository, transcribe?: (fileUrl: string) => Promise<string>, transcriberFactory?: () => Promise<((fileUrl: string) => Promise<string>) | undefined>, onSetupComplete?: () => Promise<void>, refreshTranslations?: () => Promise<void>);
    setAssistant(assistant: Assistant): void;
    /** Update Telegram bot command descriptions using translated strings. */
    updateCommands(): Promise<void>;
    /** Check onboarding state; if expired, notify the user and return true (handled). */
    private staleGuard;
    private registerOnboardingCallbacks;
    getSendMessageFn(): (message: string) => Promise<void>;
    start(): Promise<void>;
    stop(): void;
}
//# sourceMappingURL=telegram.d.ts.map