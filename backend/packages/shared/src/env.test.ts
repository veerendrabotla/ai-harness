import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "./redact.js";
import { loadEnv } from "./env.js";

describe("secret redaction (FR-008)", () => {
  it("redacts sensitive keys at any depth", () => {
    const input = {
      apiKey: "sk-abc123",
      nested: { password: "hunter2", keep: "visible" },
      list: [{ authorization: "Bearer xyz" }],
    };
    const out = redactValue(input) as typeof input;
    expect(out.apiKey).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>)["password"]).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>)["keep"]).toBe("visible");
    expect((out.list[0] as Record<string, unknown>)["authorization"]).toBe("[REDACTED]");
  });

  it("redacts secret-shaped values embedded in text", () => {
    const text = "use key sk-proj-abcdefgh12345 and jwt eyJhbGciOiJIUzI1.x.yz end";
    const out = redactText(text);
    expect(out).not.toContain("sk-proj-abcdefgh12345");
    expect(out).toContain("[REDACTED]");
  });

  it("leaves normal content untouched", () => {
    expect(redactValue({ goal: "Fix login bug", count: 3 })).toEqual({
      goal: "Fix login bug",
      count: 3,
    });
  });
});

describe("environment validation", () => {
  function baseEnv(): NodeJS.ProcessEnv {
    return {
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      JWT_ACCESS_SECRET: "0".repeat(48),
      ENCRYPTION_KEY: Buffer.from(new Uint8Array(32)).toString("base64"),
      BRIDGE_INTERNAL_TOKEN: "0".repeat(48),
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv;
  }

  it("applies documented defaults", () => {
    const env = loadEnv(baseEnv());
    expect(env.PORT).toBe(4000);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_SESSION_TTL_DAYS).toBe(30);
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.BRIDGE_GATEWAY_PORT).toBe(4010);
  });

  it("fails loudly listing every missing required variable", () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL[\s\S]*JWT_ACCESS_SECRET[\s\S]*ENCRYPTION_KEY/s);
  });

  it("rejects a short JWT secret", () => {
    const bad = { ...baseEnv(), JWT_ACCESS_SECRET: "short" };
    expect(() => loadEnv(bad)).toThrow(/JWT_ACCESS_SECRET/);
  });
});
