import { randomBytes, createHash } from 'node:crypto';

// === Types ===

export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string;
  extraParams?: Record<string, string>;
}

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface DeviceCodeResponse {
  deviceAuthId: string;
  userCode: string;
}

// === Provider configs ===

export const ANTHROPIC_OAUTH: OAuthConfig = {
  authUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  redirectUri: 'https://console.anthropic.com/oauth/code/callback',
  scopes: 'user:inference user:profile',
};

export const OPENAI_OAUTH: OAuthConfig = {
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

export function generatePKCE(): PKCEChallenge {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  return { codeVerifier, codeChallenge, state };
}

export function buildAuthUrl(config: OAuthConfig, pkce: PKCEChallenge): string {
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

export async function exchangeCodeForTokens(
  config: OAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
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

  const data = await res.json() as Record<string, unknown>;
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number | undefined,
  };
}

export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
): Promise<TokenResponse> {
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

  const data = await res.json() as Record<string, unknown>;
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number | undefined,
  };
}

// === Auth code extraction ===

export function extractAuthCode(input: string): string {
  const trimmed = input.trim();

  // Try to parse as URL with ?code= parameter
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code');
    if (code) return code;
  } catch {
    // Not a URL — treat as raw code
  }

  return trimmed;
}

// === OpenAI Device Code flow ===

export async function requestDeviceCode(config: OAuthConfig): Promise<DeviceCodeResponse> {
  const res = await fetch('https://auth.openai.com/api/accounts/deviceauth/usercode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.clientId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Device code request failed (${res.status}): ${text}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return {
    deviceAuthId: data.device_auth_id as string,
    userCode: data.user_code as string,
  };
}

export async function pollDeviceToken(
  config: OAuthConfig,
  deviceAuthId: string,
  maxAttempts = 60,
  intervalMs = 5000,
): Promise<TokenResponse> {
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
      const data = await res.json() as Record<string, unknown>;
      const authCode = data.auth_code as string | undefined;

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

        const tokenData = await tokenRes.json() as Record<string, unknown>;
        return {
          accessToken: tokenData.access_token as string,
          refreshToken: tokenData.refresh_token as string | undefined,
          expiresIn: tokenData.expires_in as number | undefined,
        };
      }
    }

    // Not ready yet — wait and retry
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Device authorization timed out. Please try again.');
}
