import { randomBytes, createHash } from 'node:crypto';
// === Provider configs ===
export const ANTHROPIC_OAUTH = {
    authUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    redirectUri: 'https://console.anthropic.com/oauth/code/callback',
    scopes: 'user:inference user:profile',
};
export const OPENAI_OAUTH = {
    authUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    redirectUri: 'http://localhost:1455/auth/callback',
    scopes: 'openid profile email offline_access',
    extraParams: {
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
    },
};
// === PKCE helpers ===
export function generatePKCE() {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const state = randomBytes(16).toString('hex');
    return { codeVerifier, codeChallenge, state };
}
export function buildAuthUrl(config, pkce) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: config.scopes,
        state: pkce.state,
        code_challenge: pkce.codeChallenge,
        code_challenge_method: 'S256',
        ...config.extraParams,
    });
    return `${config.authUrl}?${params.toString()}`;
}
// === Token exchange ===
export async function exchangeCodeForTokens(config, code, codeVerifier) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        code,
        redirect_uri: config.redirectUri,
        code_verifier: codeVerifier,
    });
    const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
    };
}
export async function refreshAccessToken(config, refreshToken) {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.clientId,
        refresh_token: refreshToken,
    });
    const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token refresh failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
    };
}
// === Auth code extraction ===
export function extractAuthCode(input) {
    const trimmed = input.trim();
    // Try to parse as URL with ?code= parameter
    try {
        const url = new URL(trimmed);
        const code = url.searchParams.get('code');
        if (code)
            return code;
    }
    catch {
        // Not a URL — treat as raw code
    }
    return trimmed;
}
// === OpenAI Device Code flow ===
export async function requestDeviceCode(config) {
    const res = await fetch('https://auth.openai.com/api/accounts/deviceauth/usercode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: config.clientId }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Device code request failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    return {
        deviceAuthId: data.device_auth_id,
        userCode: data.user_code,
    };
}
export async function pollDeviceToken(config, deviceAuthId, maxAttempts = 60, intervalMs = 5000) {
    for (let i = 0; i < maxAttempts; i++) {
        const res = await fetch('https://auth.openai.com/api/accounts/deviceauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: config.clientId,
                device_auth_id: deviceAuthId,
            }),
        });
        if (res.ok) {
            const data = await res.json();
            const authCode = data.auth_code;
            if (authCode) {
                // Exchange the auth code for tokens via standard token endpoint
                const body = new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: config.clientId,
                    code: authCode,
                    redirect_uri: config.redirectUri,
                });
                const tokenRes = await fetch(config.tokenUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: body.toString(),
                });
                if (!tokenRes.ok) {
                    const text = await tokenRes.text();
                    throw new Error(`Device token exchange failed (${tokenRes.status}): ${text}`);
                }
                const tokenData = await tokenRes.json();
                return {
                    accessToken: tokenData.access_token,
                    refreshToken: tokenData.refresh_token,
                    expiresIn: tokenData.expires_in,
                };
            }
        }
        // Not ready yet — wait and retry
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('Device authorization timed out. Please try again.');
}
//# sourceMappingURL=oauth.js.map