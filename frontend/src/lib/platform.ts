export type UserPlatform = "windows" | "macos" | "linux";

/**
 * Best-effort OS detection from browser hints. SSR-safe: returns "windows"
 * (the most common target) when no hints are available, and callers should
 * only use the result after mount to avoid hydration mismatches.
 */
export function detectPlatform(
  userAgent?: string | null,
  platform?: string | null,
): UserPlatform {
  const hint = `${userAgent ?? ""} ${platform ?? ""}`.toLowerCase();
  if (hint.includes("mac") || hint.includes("iphone") || hint.includes("ipad") || hint.includes("darwin")) {
    return "macos";
  }
  if (hint.includes("linux") || hint.includes("x11") || hint.includes("cros") || hint.includes("android")) {
    return "linux";
  }
  return "windows";
}
