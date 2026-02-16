import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Markup } from 'telegraf';

export function getAppVersion(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const pkgPath = join(dirname(thisFile), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Detect language from text using Unicode script analysis.
 * Returns language name or null if ambiguous.
 */
export function detectLanguage(text: string): string | null {
  const clean = text.replace(/https?:\/\/\S+/g, '').replace(/[0-9\s\p{P}\p{S}]/gu, '');
  if (clean.length < 3) return null;

  const cyrillic = (clean.match(/[\u0400-\u04FF]/g) || []).length;
  const latin = (clean.match(/[a-zA-Z]/g) || []).length;
  const chinese = (clean.match(/[\u4E00-\u9FFF]/g) || []).length;
  const japanese = (clean.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  const arabic = (clean.match(/[\u0600-\u06FF]/g) || []).length;

  const max = Math.max(cyrillic, latin, chinese, japanese, arabic);
  if (max < 2) return null;

  if (cyrillic === max) return 'Russian';
  if (chinese === max) return 'Chinese';
  if (japanese === max) return 'Japanese';
  if (arabic === max) return 'Arabic';
  if (latin === max) return 'English';
  return null;
}

/** Map stored language code to its native display name. */
const LANGUAGE_NATIVE_NAMES: Record<string, string> = {
  English: 'English',
  Russian: 'Русский',
  Spanish: 'Español',
  French: 'Français',
  German: 'Deutsch',
  Chinese: '中文',
};

/** Return the native display name for a stored language value (e.g. "Russian" → "Русский"). */
export function languageDisplayName(lang: string): string {
  return LANGUAGE_NATIVE_NAMES[lang] ?? lang;
}

/** Language button rows for inline keyboards. Pass a callback prefix (e.g. 'lang:' or 'onboard_lang:'). */
export function languageKeyboardRows(prefix: string) {
  return [
    [Markup.button.callback('English', `${prefix}English`), Markup.button.callback('Русский', `${prefix}Russian`)],
    [Markup.button.callback('Español', `${prefix}Spanish`), Markup.button.callback('Français', `${prefix}French`)],
    [Markup.button.callback('Deutsch', `${prefix}German`), Markup.button.callback('中文', `${prefix}Chinese`)],
  ];
}

export async function resolveTimezone(city: string): Promise<{ city: string; timezone: string } | null> {
  try {
    const resp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`);
    if (!resp.ok) return null;
    const data = await resp.json() as { results?: { name: string; timezone: string }[] };
    if (!data.results?.length) return null;
    return { city: data.results[0].name, timezone: data.results[0].timezone };
  } catch {
    return null;
  }
}

export async function resolveTimezoneFromCoords(lat: number, lon: number): Promise<{ city: string; timezone: string } | null> {
  try {
    const forecastResp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`);
    if (!forecastResp.ok) return null;
    const forecastData = await forecastResp.json() as { timezone?: string };
    const timezone = forecastData.timezone || 'UTC';

    const geoResp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=&latitude=${lat}&longitude=${lon}&count=1`);
    let city = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    if (geoResp.ok) {
      const geoData = await geoResp.json() as { results?: { name: string }[] };
      if (geoData.results?.length) {
        city = geoData.results[0].name;
      }
    }

    if (city.includes(',')) {
      const parts = timezone.split('/');
      if (parts.length >= 2) {
        city = parts[parts.length - 1].replace(/_/g, ' ');
      }
    }

    return { city, timezone };
  } catch {
    return null;
  }
}

export function splitMessage(text: string, maxLength: number): string[] {
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
