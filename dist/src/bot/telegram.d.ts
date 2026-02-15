import type { Assistant } from '../core/assistant.js';
import type { MessageRepository } from '../db/message-repository.js';
import type { ConfigManager } from '../core/config-manager.js';
import type { UsageRepository } from '../db/usage-repository.js';
export type Transcriber = (fileUrl: string) => Promise<string>;
export declare class TelegramBot {
    private bot;
    private assistant;
    private messageRepo;
    private configManager;
    private usageRepo;
    private transcribe;
    private transcriberFactory;
    private onSetupComplete?;
    private onboardingState;
    private lastLanguage;
    private awaitingThresholdInput;
    private modelsCache;
    constructor(token: string, assistant: Assistant | null, messageRepo: MessageRepository, configManager: ConfigManager, usageRepo: UsageRepository, transcribe?: Transcriber, transcriberFactory?: () => Promise<Transcriber | undefined>, onSetupComplete?: () => Promise<void>);
    setAssistant(assistant: Assistant): void;
    private registerCommands;
    private fetchAvailableModels;
    private fetchAnthropicModels;
    private settingsText;
    private settingsKeyboard;
    private sendSettingsMenu;
    private registerCallbacks;
    private registerHandlers;
    private captureChatId;
    private handleThresholdInput;
    private handleVoice;
    private sendOnboardingWelcome;
    private handleOnboardingText;
    private sendModelSelection;
    private finishOnboarding;
    private sendAskCity;
    private sendAskBirthday;
    private completeOnboarding;
    private processAndReply;
    private splitMessage;
    private sendUsageChart;
    /**
     * Returns a function that sends a message to the captured chat.
     * Used by Scheduler for alerts and reminders.
     */
    getSendMessageFn(): (message: string) => Promise<void>;
    start(): Promise<void>;
    stop(): void;
}
//# sourceMappingURL=telegram.d.ts.map