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
