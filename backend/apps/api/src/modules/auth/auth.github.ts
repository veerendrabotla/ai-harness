import type { FastifyInstance } from "fastify";
import { getEnv, errors } from "@ai-harness/shared";
import { AuthService } from "../../lib/auth-service.js";
import { REFRESH_COOKIE } from "../../lib/tokens.js";

const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function cookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/v1/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * GitHub OAuth routes.
 * Flow:
 * 1. Frontend redirects to /v1/auth/github (or opens popup)
 * 2. Backend redirects to GitHub authorization URL
 * 3. GitHub redirects back to /v1/auth/github/callback with code
 * 4. Backend exchanges code for access token
 * 5. Backend fetches user info from GitHub
 * 6. Backend creates/finds user and returns JWT
 */
export default function registerGithubAuthRoutes(app: FastifyInstance) {
  const auth = new AuthService(app.prisma);

  /**
   * Initiate GitHub OAuth flow.
   * Redirects to GitHub authorization page.
   */
  app.get("/v1/auth/github", {
    schema: {
      tags: ["auth"],
      summary: "Initiate GitHub OAuth login",
    },
  }, async (req, reply) => {
    const env = getEnv();
    const clientId = env.GITHUB_CLIENT_ID;
    const redirectUri = env.GITHUB_REDIRECT_URI || `${req.protocol}://${req.hostname}/v1/auth/github/callback`;

    if (!clientId) {
      throw errors.providerUnavailable("GitHub OAuth is not configured");
    }

    const state = Buffer.from(JSON.stringify({ redirectUri })).toString("base64url");
    const scope = "user:email";
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}`;

    return reply.redirect(url);
  });

  /**
   * GitHub OAuth callback.
   * Exchanges code for token, fetches user info, creates/finds user.
   */
  app.get("/v1/auth/github/callback", {
    schema: {
      tags: ["auth"],
      summary: "GitHub OAuth callback",
      querystring: {
        type: "object",
        required: ["code", "state"],
        properties: {
          code: { type: "string" },
          state: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const env = getEnv();
    const { code, state } = req.query as { code: string; state: string };

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      throw errors.providerUnavailable("GitHub OAuth is not configured");
    }

    // Decode state to get redirect URI
    let redirectUri: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
      redirectUri = decoded.redirectUri || `${req.protocol}://${req.hostname}/v1/auth/github/callback`;
    } catch (err) {
      req.log.debug({ err }, "GitHub OAuth state decode failed");
      throw errors.validation("Invalid OAuth state");
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      throw errors.validation("GitHub OAuth failed: " + (tokenData.error || "unknown error"));
    }

    // Fetch user info from GitHub
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `Bearer ${tokenData.access_token}`,
        "Accept": "application/json",
      },
    });

    const githubUser = await userResponse.json() as {
      id: number;
      login: string;
      email?: string;
      name?: string;
      avatar_url?: string;
    };

    // Fetch user emails (primary email might not be in user response)
    const emailsResponse = await fetch("https://api.github.com/user/emails", {
      headers: {
        "Authorization": `Bearer ${tokenData.access_token}`,
        "Accept": "application/json",
      },
    });

    const emails = await emailsResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
    const primaryEmail = emails.find((e) => e.primary && e.verified)?.email || emails[0]?.email;

    if (!primaryEmail) {
      throw errors.validation("No verified email found on GitHub account");
    }

    // Find or create user
    const { accessToken, refreshToken } = await auth.findOrCreateOAuthUser({
      email: primaryEmail,
      displayName: githubUser.name || githubUser.login,
      avatarUrl: githubUser.avatar_url,
      provider: "github",
      providerId: String(githubUser.id),
    });

    reply.setCookie(REFRESH_COOKIE, refreshToken, cookieOptions());

    // Redirect to frontend with tokens
    const frontendUrl = env.FRONTEND_URL || "http://localhost:3000";
    const redirectUrl = `${frontendUrl}/auth/callback?accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`;

    return reply.redirect(redirectUrl);
  });
}
