import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  signupRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
} from "@ai-harness/contracts";
import { AppError, errors, getEnv } from "@ai-harness/shared";
import { AuthService, toPublicUser } from "../../lib/auth-service.js";
import { REFRESH_COOKIE } from "../../lib/tokens.js";
import { ok } from "../../lib/http.js";

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

export default function registerAuthRoutes(app: FastifyInstance) {
  const auth = new AuthService(app.prisma);

  app.post(
    "/v1/auth/signup",
    {
      config: { rateLimit: { max: getEnv().RATE_LIMIT_SIGNUP_PER_HOUR, timeWindow: "1 hour" } },
      schema: {
        tags: ["auth"],
        summary: "Create a new account",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            displayName: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const input = signupRequestSchema.parse(req.body);
        const { user, accessToken, refreshToken } = await auth.signup(input);
        reply.setCookie(REFRESH_COOKIE, refreshToken, cookieOptions());
        reply.setCookie("session", accessToken, {
          httpOnly: true,
          sameSite: "lax" as const,
          secure: getEnv().NODE_ENV === "production",
          path: "/",
          maxAge: getEnv().ACCESS_TOKEN_TTL_SECONDS,
        });
        return ok(reply, { user: toPublicUser(user), accessToken, refreshToken }, 201);
      } catch (err) {
        if (err instanceof AppError) throw err;
        if (err instanceof ZodError) throw err;
        throw errors.internal(String(err));
      }
    },
  );

  app.post(
    "/v1/auth/login",
    {
      config: {
        rateLimit: { max: getEnv().RATE_LIMIT_LOGIN_PER_15MIN, timeWindow: "15 minutes", keyGenerator: (r) => r.ip },
      },
      schema: {
        tags: ["auth"],
        summary: "Sign in with email and password",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const input = loginRequestSchema.parse(req.body);
        const { user, accessToken, refreshToken } = await auth.login(input);
        reply.setCookie(REFRESH_COOKIE, refreshToken, cookieOptions());
        reply.setCookie("session", accessToken, {
          httpOnly: true,
          sameSite: "lax" as const,
          secure: getEnv().NODE_ENV === "production",
          path: "/",
          maxAge: getEnv().ACCESS_TOKEN_TTL_SECONDS,
        });
        return ok(reply, { user: toPublicUser(user), accessToken, refreshToken });
      } catch (err) {
        if (err instanceof AppError) throw err;
        if (err instanceof ZodError) throw err;
        throw errors.internal(String(err));
      }
    },
  );

  app.post("/v1/auth/refresh", {
    schema: {
      tags: ["auth"],
      summary: "Refresh access token",
    },
  }, async (req, reply) => {
    try {
      const parsed = refreshRequestSchema.parse(req.body ?? {});
      const raw = req.cookies?.[REFRESH_COOKIE] ?? parsed.refreshToken;
      if (!raw) {
        throw errors.unauthenticated("Missing refresh token");
      }
      const { accessToken, refreshToken, user } = await auth.refresh(raw);
      reply.setCookie(REFRESH_COOKIE, refreshToken, cookieOptions());
      reply.setCookie("session", accessToken, {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: getEnv().NODE_ENV === "production",
        path: "/",
        maxAge: getEnv().ACCESS_TOKEN_TTL_SECONDS,
      });
      return ok(reply, { user: toPublicUser(user), accessToken, refreshToken });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  app.post("/v1/auth/logout", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["auth"],
      summary: "Sign out and invalidate refresh token",
    },
  }, async (req, reply) => {
    try {
      const raw = req.cookies?.[REFRESH_COOKIE];
      await auth.logout(raw, req.user!.sub);
      reply.clearCookie(REFRESH_COOKIE, { path: "/v1/auth" });
      reply.clearCookie("session", { path: "/" });
      return ok(reply, { success: true });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  app.post(
    "/v1/auth/forgot-password",
    {
      config: { rateLimit: { max: getEnv().RATE_LIMIT_RESET_PER_HOUR, timeWindow: "1 hour", keyGenerator: (r) => r.ip } },
      schema: {
        tags: ["auth"],
        summary: "Request password reset email",
        body: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
          },
        },
      },
    },
    async (req, reply) => {
      const input = forgotPasswordRequestSchema.parse(req.body);
      await auth.forgotPassword(input.email);
      return ok(reply, { success: true });
    },
  );

  app.post(
    "/v1/auth/reset-password",
    {
      config: { rateLimit: { max: getEnv().RATE_LIMIT_RESET_PER_HOUR, timeWindow: "1 hour", keyGenerator: (r) => r.ip } },
      schema: {
        tags: ["auth"],
        summary: "Reset password with token",
        body: {
          type: "object",
          required: ["token", "newPassword"],
          properties: {
            token: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
          },
        },
      },
    },
    async (req, reply) => {
      const input = resetPasswordRequestSchema.parse(req.body);
      await auth.resetPassword(input.token, input.newPassword);
      reply.clearCookie(REFRESH_COOKIE, { path: "/v1/auth" });
      return ok(reply, { success: true });
    },
  );
}
