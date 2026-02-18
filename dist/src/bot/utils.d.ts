export declare function getAppVersion(): string;
/**
 * Detect language from text using Unicode script analysis.
 * Returns language name or null if ambiguous.
 */
export declare function detectLanguage(text: string): string | null;
/** Return the native display name for a stored language value (e.g. "Russian" → "Русский"). */
export declare function languageDisplayName(lang: string): string;
/** Language button rows for inline keyboards. Pass a callback prefix (e.g. 'lang:' or 'onboard_lang:'). */
export declare function languageKeyboardRows(prefix: string): (import("@telegraf/types").InlineKeyboardButton.CallbackButton & {
    hide: boolean;
})[][];
export declare function resolveTimezone(city: string): Promise<{
    city: string;
    timezone: string;
} | null>;
export declare function resolveTimezoneFromCoords(lat: number, lon: number): Promise<{
    city: string;
    timezone: string;
} | null>;
/** If text has an unclosed ``` code fence, append a closing one. */
export declare function closeUnclosedCodeFences(text: string): string;
export declare function splitMessage(text: string, maxLength: number): string[];
//# sourceMappingURL=utils.d.ts.map