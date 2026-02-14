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
export declare const ANTHROPIC_OAUTH: OAuthConfig;
export declare const OPENAI_OAUTH: OAuthConfig;
export declare function generatePKCE(): PKCEChallenge;
export declare function buildAuthUrl(config: OAuthConfig, pkce: PKCEChallenge): string;
export declare function exchangeCodeForTokens(config: OAuthConfig, code: string, codeVerifier: string): Promise<TokenResponse>;
export declare function refreshAccessToken(config: OAuthConfig, refreshToken: string): Promise<TokenResponse>;
export declare function extractAuthCode(input: string): string;
export declare function requestDeviceCode(config: OAuthConfig): Promise<DeviceCodeResponse>;
export declare function pollDeviceToken(config: OAuthConfig, deviceAuthId: string, maxAttempts?: number, intervalMs?: number): Promise<TokenResponse>;
//# sourceMappingURL=oauth.d.ts.map