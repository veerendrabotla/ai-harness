/**
 * Password-reset email E2E (PHASE 13 #10).
 *
 * Spawns a local API instance in development mode and drives the complete
 * forgot-password -> delivered token -> reset-password flow over HTTP:
 *   - forgot-password creates an unexpired, unused password_reset_tokens row
 *   - the raw token captured from the dev delivery log hashes (sha256) to the
 *     stored tokenHash — i.e. the token the email carries is the one that works
 *   - anti-enumeration: unknown emails return the same 200 envelope, emit no
 *     token, and create no extra row
 *   - reset-password consumes the token (single-use, usedAt set)
 *   - old password rejected / new password accepted
 *   - refresh sessions issued before the reset are revoked
 *   - resend-webhook round-trip: signed POST /v1/email-webhook/resend flips an
 *     email_delivery row QUEUED -> DELIVERED (bad signature rejected 401)
 *
 * Usage: npm run e2e:reset   (requires the Docker stack + .env; touches no containers)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const PORT = process.env.E2E_RESET_PORT ?? "4171";
const BASE = `http://127.0.0.1:${PORT}`;
const RESET_MSG = "Dev password reset token";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 400) : "");
  }
}

function log(msg: string): void {
  console.log(`[e2e:reset] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[e2e:reset] FAIL: ${msg}`);
  process.exit(1);
}

function loadEnv(): void {
  try {
    const raw = readFileSync(resolve(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // no .env — rely on the ambient environment
  }
}

interface Json {
  status: number;
  body: any;
}

async function call(method: string, path: string, opts: { json?: unknown } = {}): Promise<Json> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: opts.json ? { "content-type": "application/json" } : {},
    body: opts.json ? JSON.stringify(opts.json) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function extractResetToken(logs: string): string | null {
  for (const line of logs.split("\n")) {
    if (!line.includes(RESET_MSG)) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj.token === "string") return obj.token;
    } catch {
      /* non-JSON line — fall through to regexes */
    }
    const m = line.match(/"token"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
    const m2 = line.match(/token=([A-Za-z0-9_\-=]+)/);
    if (m2) return m2[1];
  }
  return null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function spawnApi(): Promise<{ child: ChildProcess; getLogs: () => string }> {
  const tsxCli = resolve(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const entry = resolve(ROOT, "backend", "apps", "api", "src", "server.ts");
  const child = spawn(process.execPath, [tsxCli, entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT,
      NODE_ENV: "development",
      // Activates HMAC signature verification on /v1/email-webhook/resend.
      RESEND_WEBHOOK_SECRET: "e2e-webhook-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", (c: Buffer) => (logs += c.toString()));
  child.stderr?.on("data", (c: Buffer) => (logs += c.toString()));
  return { child, getLogs: () => logs };
}

async function main(): Promise<void> {
  loadEnv();
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set (run from the repo root with .env present)");

  const db = new PrismaClient();
  const stamp = Date.now();
  const email = `reset-e2e-${stamp}@example.com`;
  const unknownEmail = `reset-e2e-unknown-${stamp}@example.com`;
  const firstPassword = "InitialPass123";
  const newPassword = "ResetPass456";
  let userId: string | null = null;

  const { child, getLogs } = await spawnApi();
  let childExited = false;
  child.on("exit", () => (childExited = true));

  try {
    // Wait for health (tsx compile + app boot can take a while).
    let healthy = false;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (childExited) break;
      try {
        const res = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(1_500) });
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {
        /* not up yet */
      }
      await sleep(500);
    }
    if (!healthy) {
      console.error(getLogs().split("\n").slice(-40).join("\n"));
      fail(childExited ? `API process exited early (code ${(child as any).exitCode})` : "API did not become healthy on " + BASE);
    }
    log(`API up on ${BASE} (pid ${(child as any).pid})`);

    // 1) Signup
    const signup = await call("POST", "/v1/auth/signup", {
      json: { email, password: firstPassword, displayName: "Reset E2E" },
    });
    check("signup 201", signup.status === 201 && Boolean(signup.body?.data?.accessToken), signup);
    const refreshToken: string | undefined = signup.body?.data?.refreshToken;

    const me = await db.user.findUnique({ where: { email }, select: { id: true } });
    userId = me?.id ?? null;
    check("user persisted", Boolean(userId));

    // 2) Baseline login + refresh with the original password
    const login1 = await call("POST", "/v1/auth/login", { json: { email, password: firstPassword } });
    check("login with original password", login1.status === 200 && Boolean(login1.body?.data?.accessToken), login1);
    const refresh1 = await call("POST", "/v1/auth/refresh", { json: { refreshToken } });
    check("refresh works before reset", refresh1.status === 200, refresh1);

    // 3) forgot-password (known email)
    const rowsBefore = await db.passwordResetToken.count();
    const logsBeforeKnown = getLogs().length;
    const forgot = await call("POST", "/v1/auth/forgot-password", { json: { email } });
    check("forgot-password returns 200 success envelope", forgot.status === 200 && forgot.body?.data?.success === true, forgot);

    // 4) Capture the delivered token from the dev delivery log
    let token: string | null = null;
    const tokenDeadline = Date.now() + 5_000;
    while (Date.now() < tokenDeadline && !token) {
      token = extractResetToken(getLogs().slice(logsBeforeKnown));
      if (!token) await sleep(200);
    }
    check("reset token captured from dev delivery log", Boolean(token), getLogs().slice(logsBeforeKnown).slice(-500));

    // 5) Token row matches the delivered token exactly (email carries the working token)
    const row = userId
      ? await db.passwordResetToken.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } })
      : null;
    check("token row created (unexpired, unused)", Boolean(row) && row!.usedAt === null && row!.expiresAt > new Date(), row);
    check("delivered token hashes to stored tokenHash", Boolean(token && row) && sha256(token!) === row!.tokenHash);

    // 6) Anti-enumeration: unknown email behaves identically but delivers nothing
    const logsBeforeUnknown = getLogs().length;
    const forgotUnknown = await call("POST", "/v1/auth/forgot-password", { json: { email: unknownEmail } });
    check(
      "unknown email: same 200 success envelope",
      forgotUnknown.status === forgot.status && forgotUnknown.body?.data?.success === forgot.body?.data?.success,
      forgotUnknown,
    );
    await sleep(300);
    check("unknown email: no token emitted", !getLogs().slice(logsBeforeUnknown).includes(RESET_MSG));
    const rowsAfter = await db.passwordResetToken.count();
    check("unknown email: no extra token row", rowsAfter === rowsBefore + 1, { rowsBefore, rowsAfter });

    // 7) Complete the reset with the delivered token
    const reset = await call("POST", "/v1/auth/reset-password", { json: { token, newPassword } });
    check("reset-password 200", reset.status === 200 && reset.body?.data?.success === true, reset);

    const rowUsed = row ? await db.passwordResetToken.findUnique({ where: { id: row.id }, select: { usedAt: true } }) : null;
    check("token single-use: usedAt set", Boolean(rowUsed?.usedAt));

    const reuse = await call("POST", "/v1/auth/reset-password", { json: { token, newPassword } });
    check(
      "token reuse rejected (VALIDATION_ERROR)",
      reuse.status === 400 && reuse.body?.error?.code === "VALIDATION_ERROR",
      reuse,
    );

    // 8) Password actually changed
    const loginOld = await call("POST", "/v1/auth/login", { json: { email, password: firstPassword } });
    check("old password rejected", loginOld.status === 401 && loginOld.body?.error?.code === "UNAUTHENTICATED", loginOld);
    const loginNew = await call("POST", "/v1/auth/login", { json: { email, password: newPassword } });
    check("new password accepted", loginNew.status === 200 && Boolean(loginNew.body?.data?.accessToken), loginNew);

    // 9) Pre-reset sessions revoked
    const refreshAfter = await call("POST", "/v1/auth/refresh", { json: { refreshToken } });
    check("pre-reset refresh token revoked", refreshAfter.status === 401, refreshAfter);

    // 10) Resend webhook round-trip (signed delivery event -> status flip)
    const delivery = await db.emailDelivery.create({
      data: {
        recipientEmail: email,
        templateType: "password_reset",
        subject: "Reset your AI Harness password",
        status: "QUEUED",
      },
      select: { id: true },
    });
    const webhookEvent = {
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: {
        email_id: delivery.id,
        from: "no-reply@example.com",
        to: [email],
        subject: "Reset your AI Harness password",
        created_at: new Date().toISOString(),
      },
    };
    const payload = JSON.stringify(webhookEvent);

    const badSig = await fetch(`${BASE}/v1/email-webhook/resend`, {
      method: "POST",
      headers: { "content-type": "application/json", "resend-signature": "sha256=deadbeef" },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    check("webhook rejects bad signature (401)", badSig.status === 401, badSig.status);

    const signature = createHmac("sha256", "e2e-webhook-secret").update(payload).digest("hex");
    const goodSig = await fetch(`${BASE}/v1/email-webhook/resend`, {
      method: "POST",
      headers: { "content-type": "application/json", "resend-signature": `sha256=${signature}` },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    const goodBody = (await goodSig.json().catch(() => ({}))) as Record<string, unknown>;
    check("webhook accepts signed event (200 received)", goodSig.status === 200 && goodBody.received === true, {
      status: goodSig.status,
      body: goodBody,
    });

    const delivered = await db.emailDelivery.findUnique({ where: { id: delivery.id } });
    check(
      "email_delivery QUEUED -> DELIVERED (deliveredAt set)",
      delivered?.status === "DELIVERED" && Boolean(delivered?.deliveredAt),
      { status: delivered?.status },
    );
    await db.emailDelivery.delete({ where: { id: delivery.id } }).catch(() => undefined);
  } finally {
    if (userId) {
      await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await db.$disconnect().catch(() => undefined);
    if (!childExited) {
      child.kill();
      const exitDeadline = Date.now() + 5_000;
      while (!childExited && Date.now() < exitDeadline) await sleep(100);
      if (!childExited) child.kill(9);
    }
  }

  if (failures > 0) {
    console.error(`[e2e:reset] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("[e2e:reset] all checks passed");
}

main().catch((err) => {
  console.error("[e2e:reset] fatal:", err);
  process.exit(1);
});
