import { describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "./lib/tokens.js";
import { ensureEnvLoaded } from "@ai-harness/shared";

ensureEnvLoaded();

describe("access tokens (jose HS256)", () => {
  it("round-trips claims", async () => {
    const token = await signAccessToken({
      sub: "11111111-1111-1111-1111-111111111111",
      email: "user@example.com",
      sid: "session-1",
    });
    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe("11111111-1111-1111-1111-111111111111");
    expect(claims.email).toBe("user@example.com");
    expect(claims.sid).toBe("session-1");
  });

  it("rejects tampered or wrong-audience tokens", async () => {
    const token = await signAccessToken({ sub: "s", email: "e@x.com", sid: null });
    await expect(verifyAccessToken(token + "x")).rejects.toThrow();
  });
});
