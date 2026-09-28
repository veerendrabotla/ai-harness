/**
 * Two-Factor Authentication (2FA) Service.
 * Provides TOTP-based 2FA with QR code generation.
 */
import { randomBytes } from "node:crypto";
import { createHmac, createCipheriv, createDecipheriv, randomFillSync } from "node:crypto";
import { errors, getEnv } from "@ai-harness/shared";
import type { PrismaClient } from "@prisma/client";

// TOTP configuration
const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = "sha1";

/**
 * Generate a TOTP secret for a user.
 */
export function generateTOTPSecret(): string {
  return randomBytes(20).toString("base64");
}

/**
 * Generate a TOTP URI for QR code generation.
 */
export function generateTOTPUri(secret: string, email: string, issuer: string = "AI Harness"): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=${TOTP_ALGORITHM}&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

/**
 * Generate TOTP code from secret (for verification).
 * This is a simplified implementation - in production use a proper TOTP library.
 */
export function generateTOTP(secret: string, time?: number): string {
  const counter = Math.floor((time ?? Date.now() / 1000) / TOTP_PERIOD);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", Buffer.from(secret, "base64"));
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  const lastByte = hash[hash.length - 1] ?? 0;
  const offset = lastByte & 0x0f;
  const b0 = hash[offset] ?? 0;
  const b1 = hash[offset + 1] ?? 0;
  const b2 = hash[offset + 2] ?? 0;
  const b3 = hash[offset + 3] ?? 0;
  const code = (
    ((b0 & 0x7f) << 24) |
    ((b1 & 0xff) << 16) |
    ((b2 & 0xff) << 8) |
    (b3 & 0xff)
  ) % Math.pow(10, TOTP_DIGITS);

  return code.toString().padStart(TOTP_DIGITS, "0");
}

/**
 * Verify a TOTP code.
 * Checks current window and one period before/after for clock skew.
 */
export function verifyTOTP(secret: string, code: string): boolean {
  const now = Date.now() / 1000;
  for (const offset of [-1, 0, 1]) {
    const expected = generateTOTP(secret, now + offset * TOTP_PERIOD);
    if (expected === code) return true;
  }
  return false;
}

/**
 * Generate backup codes for 2FA recovery.
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(randomBytes(4).toString("hex").toUpperCase());
  }
  return codes;
}

/**
 * Enable 2FA for a user — generates a secret and persists it as pending.
 * The user must confirm with a valid TOTP code to activate.
 */
export async function enable2FA(prisma: PrismaClient, userId: string): Promise<{
  secret: string;
  uri: string;
  backupCodes: string[];
}> {
  const secret = generateTOTPSecret();
  const backupCodes = generateBackupCodes();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const uri = generateTOTPUri(secret, user?.email ?? "user@aiharness.dev");

  // Persist the pending secret so confirm2FA can verify it
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret },
  });

  return { secret, uri, backupCodes };
}

/**
 * Confirm 2FA enablement — verifies the TOTP code, then persists the secret.
 */
export async function confirm2FA(prisma: PrismaClient, userId: string, code: string, pendingSecret: string): Promise<boolean> {
  if (!verifyTOTP(pendingSecret, code)) {
    return false;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true, twoFactorSecret: pendingSecret },
  });
  return true;
}

/**
 * Create a short-lived temp token for 2FA verification (encrypted userId with TTL).
 */
export function createTempToken(userId: string): string {
  const env = getEnv();
  const key = Buffer.from(env.ENCRYPTION_KEY, "base64").subarray(0, 32);
  const iv = randomFillSync(Buffer.alloc(12));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes
  const payload = JSON.stringify({ sub: userId, exp: expiry });
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

/**
 * Verify and decode a temp token, returning the userId if valid.
 */
export function verifyTempToken(tempToken: string): string {
  const env = getEnv();
  const key = Buffer.from(env.ENCRYPTION_KEY, "base64").subarray(0, 32);
  const raw = Buffer.from(tempToken, "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const payload = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  const claims = JSON.parse(payload) as { sub: string; exp: number };
  if (Date.now() > claims.exp) {
    throw errors.validation("2FA temp token expired");
  }
  return claims.sub;
}

/**
 * Verify 2FA code — retrieves the user's secret and validates the TOTP code.
 */
export async function verify2FA(prisma: PrismaClient, userId: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    return false;
  }
  return verifyTOTP(user.twoFactorSecret, code);
}

/**
 * Disable 2FA — requires a valid TOTP code to confirm, then clears the secret.
 */
export async function disable2FA(prisma: PrismaClient, userId: string, code: string): Promise<void> {
  const verified = await verify2FA(prisma, userId, code);
  if (!verified) {
    throw errors.validation("Invalid 2FA code");
  }
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
}
