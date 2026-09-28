/**
 * CSRF protection via double-submit cookie pattern.
 * Generates a random token, sets it as a cookie, and requires it in
 * the X-CSRF-Token header for all state-changing requests.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createHmac, randomBytes } from "node:crypto";

const CSRF_COOKIE = "ah_csrf";
const CSRF_HEADER = "x-csrf-token";
const CSRF_SECRET = process.env.CSRF_SECRET ?? (
  process.env.NODE_ENV === "development"
    ? randomBytes(32).toString("hex")
    : (() => { throw new Error("CSRF_SECRET environment variable is required in production"); })()
);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SAFE_ORIGINS = new Set<string>();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function signToken(token: string): string {
  return createHmac("sha256", CSRF_SECRET).update(token).digest("hex");
}

export function registerCsrfOrigins(origins: string[]): void {
  for (const origin of origins) {
    SAFE_ORIGINS.add(origin.replace(/\/$/, ""));
  }
}

export default async function csrfPlugin(app: FastifyInstance): Promise<void> {
  // Set CSRF cookie on first safe request
  app.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply) => {
    if (SAFE_METHODS.has(req.method)) {
      const existing = req.cookies?.[CSRF_COOKIE];
      if (!existing) {
        const token = generateToken();
        const signature = signToken(token);
        reply.setCookie(CSRF_COOKIE, `${token}.${signature}`, {
          httpOnly: false,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
          maxAge: 3600,
        });
      }
    }
  });

  // Validate CSRF on state-changing requests
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (SAFE_METHODS.has(req.method)) return;

    // Allow cross-origin API requests with valid Origin/Referer
    const origin = req.headers.origin;
    if (origin && SAFE_ORIGINS.has(origin.replace(/\/$/, ""))) return;

    // Allow same-origin requests (no origin header = same-origin)
    if (!origin) {
      const referer = req.headers.referer;
      if (!referer) {
        // No origin or referer = likely a same-origin curl/script request
        // Fall through to CSRF token check below
      }
    }

    const cookieToken = req.cookies?.[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER] as string | undefined;

    if (!cookieToken || !headerToken) {
      reply.code(403).send({
        error: { code: "CSRF_INVALID", message: "Missing CSRF token" },
      });
      return;
    }

    const [tokenPart, signaturePart] = cookieToken.split(".");
    const [headerTokenPart, headerSignaturePart] = headerToken.split(".");

    if (!tokenPart || !signaturePart || !headerTokenPart || !headerSignaturePart) {
      reply.code(403).send({
        error: { code: "CSRF_INVALID", message: "Malformed CSRF token" },
      });
      return;
    }

    // Verify tokens match
    if (!timingSafeEqual(tokenPart, headerTokenPart)) {
      reply.code(403).send({
        error: { code: "CSRF_INVALID", message: "CSRF token mismatch" },
      });
      return;
    }

    // Verify signature
    const expectedSignature = signToken(tokenPart);
    if (!timingSafeEqual(headerSignaturePart, expectedSignature)) {
      reply.code(403).send({
        error: { code: "CSRF_INVALID", message: "CSRF signature invalid" },
      });
      return;
    }
  });
}
