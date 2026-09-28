import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

const AES_KEY_LENGTH = 32;
const IV_LENGTH = 12;

function decodeKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== AES_KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${AES_KEY_LENGTH} bytes (base64-encoded), got ${key.length}`,
    );
  }
  return key;
}

/**
 * Supports key rotation: ENCRYPTION_KEY may be a comma-separated list.
 * The first key is used for encryption; all keys are tried for decryption.
 * Format: "base64key1,base64key2" — enables zero-downtime rotation.
 */
function candidateKeys(keyBase64: string): string[] {
  return keyBase64.split(",").map((k) => k.trim()).filter(Boolean);
}

function primaryKey(keyBase64: string): string {
  const first = candidateKeys(keyBase64)[0];
  if (!first) throw new Error("ENCRYPTION_KEY must contain at least one base64-encoded key");
  return first;
}

/** AES-256-GCM encryption for credentials at rest (PRD FR-009). Output: iv | tag | ciphertext. */
export function encryptSecret(plaintext: string, keyBase64: string): Buffer {
  const key = decodeKey(primaryKey(keyBase64));
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/** Decrypts a value produced by encryptSecret. Tries all candidate keys for rotation support. */
export function decryptSecret(payload: Buffer, keyBase64: string): string {
  if (payload.length < IV_LENGTH + 16) {
    throw new Error("Encrypted payload too short");
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = payload.subarray(IV_LENGTH + 16);
  const keys = candidateKeys(keyBase64);
  let lastError: Error | undefined;
  for (const k of keys) {
    try {
      const key = decodeKey(k);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error("Decryption failed with all candidate keys");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Opaque high-entropy token (refresh tokens, pairing tokens, reset tokens). */
export function generateOpaqueToken(byteLength = 48): string {
  return randomBytes(byteLength).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // Always compare full length to avoid length leak
  const maxLen = Math.max(ab.length, bb.length);
  const aPadded = Buffer.alloc(maxLen, 0);
  const bPadded = Buffer.alloc(maxLen, 0);
  ab.copy(aPadded);
  bb.copy(bPadded);
  return timingSafeEqual(aPadded, bPadded);
}
