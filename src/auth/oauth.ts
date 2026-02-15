import { randomBytes, createHash } from 'node:crypto';

// === Types ===

export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string;
  extraParams?: Record<string, string>;
  /** If true, token endpoint expects JSON body instead of form-urlencoded. */
  tokenJson?: boolean;
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
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  redirectUri: 'https://platform.claude.com/oauth/code/callback',
  scopes: 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers',
  tokenJson: true,
  extraParams: { code: 'true' },
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
  state?: string,
): Promise<TokenResponse> {
  const payload: Record<string, string> = {
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

  const data = await res.json() as Record<string, unknown>;
  console.log('[OAuth] Token exchange response:', JSON.stringify({
    scope: data.scope,
    token_type: data.token_type,
    expires_in: data.expires_in,
    access_token_prefix: typeof data.access_token === 'string' ? data.access_token.slice(0, 20) + '...' : undefined,
  }));
  return parseTokenResponse(data);
}

export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
): Promise<TokenResponse> {
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

  return parseTokenResponse(await res.json() as Record<string, unknown>);
}

// === Internal helpers ===

function tokenRequestOptions(
  config: OAuthConfig,
  payload: Record<string, string>,
): { headers: Record<string, string>; body: string } {
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

function parseTokenResponse(data: Record<string, unknown>): TokenResponse {
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

  // Strip URL fragment (#state) if present
  const hashIdx = trimmed.indexOf('#');
  return hashIdx !== -1 ? trimmed.slice(0, hashIdx) : trimmed;
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
  onProgress?: (attempt: number, maxAttempts: number, status: string) => void,
): Promise<TokenResponse> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch('https://auth.openai.com/api/accounts/deviceauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: config.clientId,
          device_auth_id: deviceAuthId,
        }),
      });

      const data = await res.json() as Record<string, unknown>;

      if (res.ok) {
        // The response may contain access_token directly or auth_code to exchange
        if (data.access_token) {
          return {
            accessToken: data.access_token as string,
            refreshToken: data.refresh_token as string | undefined,
            expiresIn: data.expires_in as number | undefined,
          };
        }

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

      // Report polling status
      const status = (data.error as string) || `http ${res.status}`;
      onProgress?.(i + 1, maxAttempts, status);
    } catch (err) {
      // Network errors during polling are non-fatal — just retry
      onProgress?.(i + 1, maxAttempts, 'network error');
      if (i === maxAttempts - 1) throw err;
    }

    // Not ready yet — wait and retry
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Device authorization timed out. Please try again.');
}
