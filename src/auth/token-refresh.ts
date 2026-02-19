import type { ConfigManager } from '../core/config-manager.js';
import type { AiProvider } from '../core/types.js';
import { refreshAccessToken, refreshQwenToken, ANTHROPIC_OAUTH, OPENAI_OAUTH } from './oauth.js';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function tryRefresh(
  configManager: ConfigManager,
  onRefreshed?: () => Promise<void>,
): Promise<void> {
  if (!configManager.isTokenExpiringSoon()) return;

  const config = configManager.getConfig();
  const ai = config.ai;
  if (!ai?.refreshToken) return;

  let tokens;
  if (ai.provider === 'qwen') {
    tokens = await refreshQwenToken(ai.refreshToken);
  } else {
    const oauthConfig = ai.provider === 'anthropic' ? ANTHROPIC_OAUTH : OPENAI_OAUTH;
    tokens = await refreshAccessToken(oauthConfig, ai.refreshToken);
  }

  const expiresAt = tokens.expiresIn
    ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
    : undefined;

  configManager.updateAuthToken(
    tokens.accessToken,
    tokens.refreshToken ?? ai.refreshToken,
    expiresAt,
    tokens.resourceUrl,
  );

  console.log('OAuth token refreshed successfully.');

  // Rebuild the assistant so it picks up the new token
  if (onRefreshed) await onRefreshed();
}

/**
 * Force-refresh the OAuth token for a specific provider.
 * Works for both the active provider and saved providers.
 * Returns true if refresh succeeded.
 */
export async function forceTokenRefresh(
  configManager: ConfigManager,
  provider: AiProvider,
): Promise<boolean> {
  const config = configManager.getConfig();
  const ai = config.ai?.provider === provider
    ? config.ai
    : configManager.getSavedProvider(provider);

  if (!ai?.refreshToken) {
    console.log(`[TokenRefresh] ${provider}: no refresh token available`);
    return false;
  }

  try {
    let tokens;
    if (provider === 'qwen') {
      tokens = await refreshQwenToken(ai.refreshToken);
    } else {
      const oauthConfig = provider === 'anthropic' ? ANTHROPIC_OAUTH : OPENAI_OAUTH;
      tokens = await refreshAccessToken(oauthConfig, ai.refreshToken);
    }

    const expiresAt = tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : undefined;

    configManager.updateSavedProviderToken(
      provider,
      tokens.accessToken,
      tokens.refreshToken ?? ai.refreshToken,
      expiresAt,
      tokens.resourceUrl,
    );

    console.log(`[TokenRefresh] ${provider}: token refreshed successfully`);
    return true;
  } catch (err) {
    console.error(`[TokenRefresh] ${provider}: refresh failed —`, err instanceof Error ? err.message : err);
    return false;
  }
}

export function startTokenRefreshLoop(
  configManager: ConfigManager,
  onRefreshed?: () => Promise<void>,
): NodeJS.Timeout {
  // Refresh immediately on start, then every 5 minutes
  tryRefresh(configManager, onRefreshed).catch((err) => {
    console.error('Failed to refresh OAuth token:', err);
  });

  return setInterval(async () => {
    try {
      await tryRefresh(configManager, onRefreshed);
    } catch (err) {
      console.error('Failed to refresh OAuth token:', err);
    }
  }, REFRESH_INTERVAL_MS);
}
