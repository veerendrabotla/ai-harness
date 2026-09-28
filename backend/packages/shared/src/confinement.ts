import { isAbsolute, normalize, resolve, sep } from "node:path";

/**
 * Path confinement for Local Bridge operations.
 *
 * The BROWSER never enforces boundaries; the bridge re-validates everything
 * server-side of the user's filesystem (PRD F-12 / FR-015). This module is
 * shared so tests and the agent use identical semantics.
 */

export interface ConfinementResult {
  allowed: boolean;
  /** Absolute, normalized path when allowed. */
  resolved?: string;
  reason?: string;
}

function normalizeRoot(p: string): string {
  let r = resolve(p);
  if (!(r.endsWith(sep))) r += sep;
  return normalize(r);
}

export function confinePath(rootDir: string, userPath: string): ConfinementResult {
  if (typeof userPath !== "string" || userPath.length === 0) {
    return { allowed: false, reason: "empty path" };
  }
  // Reject null bytes
  if (userPath.includes("%00") || userPath.includes("\0")) {
    return { allowed: false, reason: "null byte in path" };
  }
  // Reject explicit traversal and absolute escapes before normalization.
  let decoded: string;
  try {
    decoded = decodeURIComponent(userPath);
  } catch (err) {
    console.error("[Confinement] URI decode error:", err);
    return { allowed: false, reason: "invalid URI encoding" };
  }
  if (decoded.includes("..")) {
    return { allowed: false, reason: "path traversal rejected" };
  }
  const root = normalizeRoot(rootDir);
  const candidate = isAbsolute(decoded) ? normalize(decoded) : resolve(root, decoded);

  if (!isAbsolute(candidate)) {
    return { allowed: false, reason: "path did not resolve to an absolute location" };
  }
  const candidateNorm = candidate.endsWith(sep) ? candidate : candidate + sep;
  if (!candidateNorm.startsWith(root)) {
    return { allowed: false, reason: "outside registered project root" };
  }
  return { allowed: true, resolved: candidate };
}
