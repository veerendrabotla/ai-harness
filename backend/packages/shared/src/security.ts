/** SSRF guard for the policy-restricted http.request tool. */

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(?:6[4-9]|[7-9]\d|1[0-2][0-7])\./,
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
  /^\[?ff[0-9a-f]{2}:/i,
  /^22[4-9]\./,
  /^23[0-9]\./,
  /\.internal$/i,
];

export interface UrlGuardResult {
  allowed: boolean;
  reason?: string;
}

export function isSafeOutboundUrl(rawUrl: string): UrlGuardResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (err) {
    console.error("[Security] URL parse error:", err);
    return { allowed: false, reason: "invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { allowed: false, reason: `protocol ${url.protocol} not permitted` };
  }
  const host = url.hostname;
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    return { allowed: false, reason: "requests to private/internal addresses are denied by policy" };
  }
  return { allowed: true };
}

const LOOPBACK_HOST_PATTERNS: RegExp[] = [/^localhost$/i, /^127(\.\d{1,3}){3}$/, /^\[?::1\]?$/];

/**
 * Inverse-polarity guard for the preview proxy: destinations are preview dev
 * servers bound to loopback on the bridge host. Allows ONLY loopback http/https
 * so the proxy can never be used to reach other machines or internal networks.
 */
export function isLoopbackUrl(rawUrl: string): UrlGuardResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { allowed: false, reason: `protocol ${url.protocol} not permitted` };
  }
  if (!LOOPBACK_HOST_PATTERNS.some((re) => re.test(url.hostname))) {
    return { allowed: false, reason: "preview proxy destinations must be loopback (localhost) addresses" };
  }
  return { allowed: true };
}
