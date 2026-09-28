/**
 * Secret redaction pipeline.
 * Applied to log payloads, event payloads, context manifests and tool summaries
 * before persistence or transport (PRD FR-008).
 */

const SENSITIVE_KEY_FRAGMENTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "credential",
  "privatekey",
  "private_key",
  "sessionid",
  "cookie",
];

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g, // OpenAI-style keys
  /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, // Anthropic keys
  /\bAIza[0-9A-Za-z_-]{10,}\b/g, // Google API keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT-shaped values
];

export const REDACTED = "[REDACTED]";

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z_]/g, "");
  return SENSITIVE_KEY_FRAGMENTS.some((frag) => k.includes(frag));
}

export function redactText(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

export function redactValue<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (typeof value === "string") {
    return redactText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1)) as unknown as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof Buffer)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out as unknown as T;
  }
  return value;
}
