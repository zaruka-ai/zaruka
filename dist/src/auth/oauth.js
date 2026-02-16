import { randomBytes, createHash } from 'node:crypto';
// === Provider configs ===
export const ANTHROPIC_OAUTH = {
    authUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://platform.claude.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    redirectUri: 'https://platform.claude.com/oauth/code/callback',
    scopes: 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers',
    tokenJson: true,
    extraParams: { code: 'true' },
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
export async function exchangeCodeForTokens(config, code, codeVerifier, state) {
    const payload = {
        grant_type: 'authorization_code',
        client_id: config.clientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: config.redirectUri,
    };
    if (state) {
        payload.state = state;
    }
    const res = await fetch(config.tokenUrl, {
        method: 'POST',
        ...tokenRequestOptions(config, payload),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    console.log('[OAuth] Token exchange response:', JSON.stringify({
        scope: data.scope,
        token_type: data.token_type,
        expires_in: data.expires_in,
        access_token_prefix: typeof data.access_token === 'string' ? data.access_token.slice(0, 20) + '...' : undefined,
    }));
    return parseTokenResponse(data);
}
export async function refreshAccessToken(config, refreshToken) {
    const payload = {
        grant_type: 'refresh_token',
        client_id: config.clientId,
        refresh_token: refreshToken,
    };
    const res = await fetch(config.tokenUrl, {
        method: 'POST',
        ...tokenRequestOptions(config, payload),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token refresh failed (${res.status}): ${text}`);
    }
    return parseTokenResponse(await res.json());
}
// === Internal helpers ===
function tokenRequestOptions(config, payload) {
    if (config.tokenJson) {
        return {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        };
    }
    return {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(payload).toString(),
    };
}
function parseTokenResponse(data) {
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
    // Strip URL fragment (#state) if present
    const hashIdx = trimmed.indexOf('#');
    return hashIdx !== -1 ? trimmed.slice(0, hashIdx) : trimmed;
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
export async function pollDeviceToken(config, deviceAuthId, userCode, maxAttempts = 60, intervalMs = 5000, onProgress) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await fetch('https://auth.openai.com/api/accounts/deviceauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: config.clientId,
                    device_auth_id: deviceAuthId,
                    user_code: userCode,
                }),
            });
            const data = await res.json();
            console.log(`[DevicePoll] status=${res.status} data=${JSON.stringify(data).slice(0, 300)}`);
            if (res.ok) {
                // The response may contain access_token directly or auth_code to exchange
                if (data.access_token) {
                    return {
                        accessToken: data.access_token,
                        refreshToken: data.refresh_token,
                        expiresIn: data.expires_in,
                    };
                }
                const authCode = (data.authorization_code || data.auth_code);
                if (authCode) {
                    console.log('[DevicePoll] Got authorization_code, exchanging for tokens...');
                    const codeVerifier = data.code_verifier;
                    // Device code flow uses a server-side callback, not the local redirect
                    const deviceRedirectUri = new URL(config.tokenUrl).origin + '/deviceauth/callback';
                    const body = new URLSearchParams({
                        grant_type: 'authorization_code',
                        client_id: config.clientId,
                        code: authCode,
                        redirect_uri: deviceRedirectUri,
                        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
                    });
                    console.log(`[DevicePoll] Token exchange: url=${config.tokenUrl} redirect_uri=${deviceRedirectUri}`);
                    const tokenRes = await fetch(config.tokenUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: body.toString(),
                    });
                    const tokenText = await tokenRes.text();
                    console.log(`[DevicePoll] Token exchange response: status=${tokenRes.status} body=${tokenText.slice(0, 200)}`);
                    if (!tokenRes.ok) {
                        // Auth code is one-time use — retrying won't help
                        throw new Error(`Device token exchange failed (${tokenRes.status}): ${tokenText}`);
                    }
                    const tokenData = JSON.parse(tokenText);
                    return {
                        accessToken: tokenData.access_token,
                        refreshToken: tokenData.refresh_token,
                        expiresIn: tokenData.expires_in,
                    };
                }
            }
            // Report polling status
            const rawError = data.error;
            const status = (typeof rawError === 'string' ? rawError : rawError ? JSON.stringify(rawError) : null) || `http ${res.status}`;
            onProgress?.(i + 1, maxAttempts, status);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Token exchange failures are fatal — auth code is single-use
            if (msg.includes('Device token exchange failed'))
                throw err;
            // Other errors (network etc.) are non-fatal — just retry
            console.error(`[DevicePoll] Error: ${msg}`);
            onProgress?.(i + 1, maxAttempts, 'network error');
            if (i === maxAttempts - 1)
                throw err;
        }
        // Not ready yet — wait and retry
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('Device authorization timed out. Please try again.');
}
//# sourceMappingURL=oauth.js.map