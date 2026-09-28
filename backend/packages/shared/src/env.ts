import { z } from "zod";

/**
 * Central environment configuration.
 *
 * The application fails fast at startup when required variables are missing
 * or malformed. No secret may ever be hardcoded.
 */

const booleanish = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const EnvSchema = z.object({
  // Application
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  FRONTEND_ORIGIN: z.string().min(1).default("http://localhost:3000"),
  FRONTEND_URL: z.string().optional(),
  API_BASE_URL: z.string().min(1).default("http://localhost:4000"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SHADOW_DATABASE_URL: z.string().optional(),

  // Redis (queue + rate limiting)
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  // Worker
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // Authentication
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_ISSUER: z.string().min(1).default("ai-harness"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().positive().default(30),

  // Encryption (AES-256-GCM key, base64-encoded 32 bytes).
  // Supports rotation: comma-separated list where first key encrypts and all keys are tried for decryption.
  // Example: "newBase64Key,oldBase64Key" — deploy new key first, then decrypt tries new then old.
  ENCRYPTION_KEY: z
    .string()
    .min(43, "ENCRYPTION_KEY must be a base64-encoded 32-byte key (or comma-separated list for rotation)"),

  // Local Bridge (gateway ships next phase; TTLs reserved)
  BRIDGE_PAIRING_TOKEN_TTL_MINUTES: z.coerce.number().positive().default(15),
  BRIDGE_SESSION_TOKEN_TTL_MINUTES: z.coerce.number().positive().default(10),
  BRIDGE_GATEWAY_PORT: z.coerce.number().int().positive().default(4010),
  BRIDGE_GATEWAY_URL: z.string().min(1).default("http://localhost:4010"),
  BRIDGE_INTERNAL_TOKEN: z
    .string()
    .min(32, "BRIDGE_INTERNAL_TOKEN must be at least 32 characters"),

  // Rate limiting overrides (defaults follow BACKEND_STRUCTURE §7)
  RATE_LIMIT_SIGNUP_PER_HOUR: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_LOGIN_PER_15MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_RESET_PER_HOUR: z.coerce.number().int().positive().default(5),
  // Global per-IP/per-user API budget (BACKEND_STRUCTURE §7); default 100/min.
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(100),
  // Cloud Sandbox — docker is the secure default; "" falls back to host temp dir (dev only)
  SANDBOX_MODE: z.enum(["docker", ""]).default("docker"),
  SANDBOX_IMAGE: z.string().default("node:22-alpine"),

  // Observability
  SENTRY_DSN: z.string().optional(),

  // OAuth providers (optional)
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  // Email delivery (Resend)
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),

  // SSO providers (optional)
  OKTA_ISSUER_URL: z.string().optional(),

  // Webhook secrets (optional — when unset, signature verification is skipped)
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITLAB_WEBHOOK_SECRET: z.string().optional(),
  BITBUCKET_WEBHOOK_SECRET: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),

  // Feature flags used during phased implementation
  ENABLE_REALTIME_SOCKET: booleanish.default("true"),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration. Fix the following before starting:\n${issues}`,
    );
  }
  return parsed.data;
}

/** Cached accessor. Throws with a clear message when configuration is invalid. */
export function getEnv(): AppEnv {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Test helper: reset the cached environment. */
export function resetEnvCache(): void {
  cached = null;
}

export function frontendOrigins(env: AppEnv): string[] {
  return env.FRONTEND_ORIGIN.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
