import type { FastifyInstance } from "fastify";
import { getEnv, errors } from "@ai-harness/shared";
import { AuthService } from "../../lib/auth-service.js";
import { REFRESH_COOKIE } from "../../lib/tokens.js";

const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function cookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    sameSite: env.COOKIE_SAMESITE,
    secure: env.NODE_ENV === "production" || env.COOKIE_SAMESITE === "none",
    path: "/v1/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * Google OAuth routes.
 * Flow:
 * 1. Frontend redirects to /v1/auth/google (or opens popup)
 * 2. Backend redirects to Google authorization URL
 * 3. Google redirects back to /v1/auth/google/callback with code
 * 4. Backend exchanges code for access token
 * 5. Backend fetches user info from Google
 * 6. Backend creates/finds user and returns JWT
 */
export default function registerGoogleAuthRoutes(app: FastifyInstance) {
  const auth = new AuthService(app.prisma);

  /**
   * Initiate Google OAuth flow.
   * Redirects to Google authorization page.
   */
  app.get("/v1/auth/google", {
    schema: {
      tags: ["auth"],
      summary: "Initiate Google OAuth login",
    },
  }, async (req, reply) => {
    const env = getEnv();
    const clientId = env.GOOGLE_CLIENT_ID;
    const redirectUri = env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.hostname}/v1/auth/google/callback`;

    if (!clientId) {
      throw errors.providerUnavailable("Google OAuth is not configured");
    }

    const state = Buffer.from(JSON.stringify({ redirectUri })).toString("base64url");
    const scope = "openid email profile";
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}&access_type=offline`;

    return reply.redirect(url);
  });

  /**
   * Google OAuth callback.
   * Exchanges code for token, fetches user info, creates/finds user.
   */
  app.get("/v1/auth/google/callback", {
    schema: {
      tags: ["auth"],
      summary: "Google OAuth callback",
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

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw errors.providerUnavailable("Google OAuth is not configured");
    }

    // Decode state to get redirect URI
    let redirectUri: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
      redirectUri = decoded.redirectUri || `${req.protocol}://${req.hostname}/v1/auth/google/callback`;
    } catch (err) {
      req.log.debug({ err }, "Google OAuth state decode failed");
      throw errors.validation("Invalid OAuth state");
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      throw errors.validation("Google OAuth failed: " + (tokenData.error || "unknown error"));
    }

    // Fetch user info from Google
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        "Authorization": `Bearer ${tokenData.access_token}`,
      },
    });

    const googleUser = await userResponse.json() as {
      id: string;
      email: string;
      name: string;
      picture?: string;
    };

    // Find or create user
    const { accessToken, refreshToken } = await auth.findOrCreateOAuthUser({
      email: googleUser.email,
      displayName: googleUser.name,
      avatarUrl: googleUser.picture,
      provider: "google",
      providerId: googleUser.id,
    });

    reply.setCookie(REFRESH_COOKIE, refreshToken, cookieOptions());

    // Redirect to frontend with tokens
    const frontendUrl = env.FRONTEND_URL || "http://localhost:3000";
    const redirectUrl = `${frontendUrl}/auth/callback?accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`;

    return reply.redirect(redirectUrl);
  });
}
