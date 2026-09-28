/**
 * SSO Service.
 * Handles OAuth token exchange and SAML assertion parsing for various providers.
 */
import { getEnv } from "@ai-harness/shared";

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
}

interface UserInfo {
  email: string;
  name: string;
  avatarUrl?: string;
  providerId?: string;
}

/**
 * Exchange OAuth authorization code for tokens and extract user info.
 */
export async function exchangeOAuthCode(
  provider: string,
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<UserInfo> {
  const tokenEndpoint = getTokenEndpoint(provider);
  const userInfoEndpoint = getUserInfoEndpoint(provider);

  // Exchange code for tokens
  const tokenResponse = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`OAuth token exchange failed: ${tokenResponse.status} ${errorText}`);
  }

  const tokens = (await tokenResponse.json()) as OAuthTokenResponse;

  // Fetch user info
  const userInfoResponse = await fetch(userInfoEndpoint, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!userInfoResponse.ok) {
    throw new Error(`Failed to fetch user info: ${userInfoResponse.status}`);
  }

  const rawUserInfo = (await userInfoResponse.json()) as Record<string, unknown>;

  return normalizeUserInfo(provider, rawUserInfo);
}

/**
 * Get the token endpoint for a given provider.
 */
function getTokenEndpoint(provider: string): string {
  switch (provider) {
    case "okta":
      return `${getEnv().OKTA_ISSUER_URL ?? ""}/oauth2/default/v1/token`;
    case "azure_ad":
      return "https://login.microsoftonline.com/common/oauth2/v2.0/token";
    case "google":
      return "https://oauth2.googleapis.com/token";
    default:
      throw new Error(`Unsupported OAuth provider: ${provider}`);
  }
}

/**
 * Get the userinfo endpoint for a given provider.
 */
function getUserInfoEndpoint(provider: string): string {
  switch (provider) {
    case "okta":
      return `${getEnv().OKTA_ISSUER_URL ?? ""}/oauth2/default/v1/userinfo`;
    case "azure_ad":
      return "https://graph.microsoft.com/v1.0/me";
    case "google":
      return "https://www.googleapis.com/oauth2/v3/userinfo";
    default:
      throw new Error(`Unsupported OAuth provider: ${provider}`);
  }
}

/**
 * Normalize user info from different providers into a common format.
 */
function normalizeUserInfo(provider: string, raw: Record<string, unknown>): UserInfo {
  switch (provider) {
    case "okta":
      return {
        email: raw.email as string,
        name: (raw.name as string) ?? (raw.preferred_username as string) ?? "",
        avatarUrl: raw.picture as string | undefined,
        providerId: raw.sub as string,
      };
    case "azure_ad":
      return {
        email: (raw.mail as string) ?? (raw.userPrincipalName as string) ?? "",
        name: (raw.displayName as string) ?? "",
        avatarUrl: undefined,
        providerId: raw.id as string,
      };
    case "google":
      return {
        email: raw.email as string,
        name: raw.name as string,
        avatarUrl: raw.picture as string | undefined,
        providerId: raw.sub as string,
      };
    default:
      return {
        email: (raw.email as string) ?? "",
        name: (raw.name as string) ?? "",
      };
  }
}

/**
 * Build the OAuth authorization URL for a given provider.
 */
export function buildAuthorizationUrl(
  provider: string,
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const scope = provider === "google" ? "openid email profile" : "openid email profile";
  const baseParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state,
  });

  switch (provider) {
    case "okta":
      return `${getEnv().OKTA_ISSUER_URL ?? ""}/oauth2/default/v1/authorize?${baseParams.toString()}`;
    case "azure_ad":
      return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${baseParams.toString()}`;
    case "google":
      return `https://accounts.google.com/o/oauth2/v2/auth?${baseParams.toString()}`;
    default:
      throw new Error(`Unsupported OAuth provider: ${provider}`);
  }
}
