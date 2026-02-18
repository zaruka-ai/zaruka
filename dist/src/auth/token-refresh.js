import { refreshAccessToken, ANTHROPIC_OAUTH, OPENAI_OAUTH } from './oauth.js';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
async function tryRefresh(configManager, onRefreshed) {
    if (!configManager.isTokenExpiringSoon())
        return;
    const config = configManager.getConfig();
    const ai = config.ai;
    if (!ai?.refreshToken)
        return;
    const oauthConfig = ai.provider === 'anthropic' ? ANTHROPIC_OAUTH : OPENAI_OAUTH;
    const tokens = await refreshAccessToken(oauthConfig, ai.refreshToken);
    const expiresAt = tokens.expiresIn
        ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
        : undefined;
    configManager.updateAuthToken(tokens.accessToken, tokens.refreshToken ?? ai.refreshToken, expiresAt);
    console.log('OAuth token refreshed successfully.');
    // Rebuild the assistant so it picks up the new token
    if (onRefreshed)
        await onRefreshed();
}
export function startTokenRefreshLoop(configManager, onRefreshed) {
    // Refresh immediately on start, then every 5 minutes
    tryRefresh(configManager, onRefreshed).catch((err) => {
        console.error('Failed to refresh OAuth token:', err);
    });
    return setInterval(async () => {
        try {
            await tryRefresh(configManager, onRefreshed);
        }
        catch (err) {
            console.error('Failed to refresh OAuth token:', err);
        }
    }, REFRESH_INTERVAL_MS);
}
//# sourceMappingURL=token-refresh.js.map