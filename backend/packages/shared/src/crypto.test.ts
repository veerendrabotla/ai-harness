import { describe, expect, it } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  generateOpaqueToken,
  sha256Hex,
  safeEqual,
} from "./crypto.js";

const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

describe("credential encryption (AES-256-GCM)", () => {
  it("round-trips a provider API key", () => {
    const secret = "sk-ant-api03-abcdef0123456789";
    const encrypted = encryptSecret(secret, KEY);
    expect(encrypted.length).toBeGreaterThan(28);
    expect(encrypted.includes(Buffer.from(secret))).toBe(false); // never plaintext
    expect(decryptSecret(encrypted, KEY)).toBe(secret);
  });

  it("produces distinct ciphertexts per call (random nonce)", () => {
    const a = encryptSecret("same-input", KEY);
    const b = encryptSecret("same-input", KEY);
    expect(a.equals(b)).toBe(false);
  });

  it("rejects tampered payloads (auth tag failure)", () => {
    const encrypted = encryptSecret("sensitive", KEY);
    encrypted.set([(encrypted[3] ?? 0) ^ 0xff], 3);
    expect(() => decryptSecret(encrypted, KEY)).toThrow();
  });

  it("refuses keys that are not exactly 32 bytes", () => {
    const shortKey = Buffer.from(new Uint8Array(16)).toString("base64");
    expect(() => encryptSecret("x", shortKey)).toThrow(/32 bytes/);
  });
});

describe("opaque tokens", () => {
  it("generates URL-safe high-entropy tokens", () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{60,68}$/);
    expect(token).not.toBe(generateOpaqueToken());
  });
});

describe("hashing + comparison", () => {
  it("hashes deterministically for storage lookups", () => {
    expect(sha256Hex("refresh-token")).toBe(sha256Hex("refresh-token"));
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });

  it("compares safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });
});
