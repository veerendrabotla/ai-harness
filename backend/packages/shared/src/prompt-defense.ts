import { randomBytes } from "node:crypto";

/**
 * Prompt-injection defenses for repository/context/MCP content (PRD F-09,
 * AGENT_RUNTIME §10). Untrusted text is fenced behind randomized delimiters so
 * a malicious file cannot forge the closing fence or impersonate system turns.
 */

export function makeFence(): string {
  return `UNTRUSTED_${randomBytes(6).toString("hex")}`;
}

/** Neutralizes look-alike closing fences and fake role markers inside untrusted text. */
export function sanitizeUntrusted(text: string, fence = makeFence()): string {
  let out = text;
  // Break any occurrence of our own fence tokens.
  out = out.split(fence).join(`${fence.slice(0, -2)}_${fence.slice(-2)}`);
  // Neutralize common injection scaffolding.
  out = out.replace(/<\/?(?:context|untrusted|system|assistant|user|tool)\b[^>]*>/gi, (m) =>
    m.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );
  return out;
}

export function fenceUntrusted(label: string, text: string, fence = makeFence()): string {
  const safeLabel = label.replace(/["<>\n]/g, "");
  return `<untrusted source="${safeLabel}" fence="${fence}">\n${sanitizeUntrusted(text, fence)}\n</untrusted>`;
}
