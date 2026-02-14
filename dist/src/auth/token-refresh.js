import { refreshAccessToken, ANTHROPIC_OAUTH, OPENAI_OAUTH } from './oauth.js';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export function startTokenRefreshLoop(configManager) {
    return setInterval(async () => {
        try {
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
        }
        catch (err) {
            console.error('Failed to refresh OAuth token:', err);
        }
    }, REFRESH_INTERVAL_MS);
}
//# sourceMappingURL=token-refresh.js.map