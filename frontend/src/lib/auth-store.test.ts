import { describe, expect, it } from "vitest";
import { buildSessionCookie, useAuthStore } from "./auth-store.js";

function makeToken(expSecondsFromNow: number, nowMs: number): string {
  const payload = { sub: "user-1", exp: Math.floor(nowMs / 1000) + expSecondsFromNow };
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `eyJhbGciOiJIUzI1NiJ9.${b64}.signature`;
}

describe("buildSessionCookie", () => {
  const nowMs = 1_700_000_000_000;

  it("derives Max-Age from the JWT exp claim", () => {
    const token = makeToken(3600, nowMs);
    const cookie = buildSessionCookie(token, false, nowMs);
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).toContain(`session=${token}`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });

  it("adds the Secure attribute for https origins", () => {
    const cookie = buildSessionCookie(makeToken(60, nowMs), true, nowMs);
    expect(cookie).toContain("; Secure");
  });

  it("keeps a floor of 60s for already-expired tokens", () => {
    const cookie = buildSessionCookie(makeToken(-3600, nowMs), false, nowMs);
    expect(cookie).toContain("Max-Age=60");
  });

  it("falls back to a default TTL for non-JWT values", () => {
    const cookie = buildSessionCookie("not-a-jwt", false, nowMs);
    expect(cookie).toContain("Max-Age=900");
    expect(cookie).toContain("session=not-a-jwt");
  });
});

describe("auth store actions", () => {
  it("setSession and setAccessToken run without a DOM (node/SSR)", () => {
    const token = makeToken(900, Date.now());
    expect(() => useAuthStore.getState().setSession({ id: "u1" } as never, token)).not.toThrow();
    expect(useAuthStore.getState().accessToken).toBe(token);
    expect(() => useAuthStore.getState().setAccessToken(token)).not.toThrow();
    expect(() => useAuthStore.getState().clearSession()).not.toThrow();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });
});
