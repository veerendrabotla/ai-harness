import { describe, it, expect } from "vitest";

import { detectPlatform } from "./platform";

describe("detectPlatform", () => {
  it("detects Windows from Chrome on Windows 10", () => {
    expect(
      detectPlatform(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Win32",
      ),
    ).toBe("windows");
  });

  it("detects macOS from Safari on Apple silicon", () => {
    expect(
      detectPlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "MacIntel",
      ),
    ).toBe("macos");
  });

  it("detects macOS from iPhone user agents", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "iPhone")).toBe("macos");
  });

  it("detects Linux from Firefox on Ubuntu", () => {
    expect(
      detectPlatform(
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "Linux x86_64",
      ),
    ).toBe("linux");
  });

  it("detects Linux from ChromeOS user agents", () => {
    expect(detectPlatform("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)", "Linux x86_64")).toBe("linux");
  });

  it("defaults to Windows when hints are missing", () => {
    expect(detectPlatform(null, null)).toBe("windows");
    expect(detectPlatform(undefined, undefined)).toBe("windows");
    expect(detectPlatform("", "")).toBe("windows");
  });
});
