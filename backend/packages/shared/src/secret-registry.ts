/**
 * SecretRegistry — OpenHands-inspired memory-only secret vault with auto-masking.
 *
 * Secrets are stored in memory only (never persisted to DB), injected as env
 * vars only when a command references them, and masked in all tool output.
 *
 * Usage:
 *   registry.updateSecrets({ GITHUB_TOKEN: "ghp_xxx", OPENAI_API_KEY: () => vault.get("openai") });
 *   registry.injectEnv(command);        // → { GITHUB_TOKEN: "ghp_xxx" } only if `command` contains $GITHUB_TOKEN
 *   registry.maskOutput(output);         // → replaces every secret value with "***"
 */

type SecretValue = string | { getValue(): string };

export class SecretRegistry {
  private secrets = new Map<string, SecretValue>();
  private maskedValues = new Map<string, string>(); // value → "***masked***"

  /** Store or update secrets. Accepts plain strings or SecretSource callables. */
  updateSecrets(entries: Record<string, SecretValue>): void {
    for (const [key, value] of Object.entries(entries)) {
      this.secrets.set(key, value);
      const plain = this.resolve(value);
      if (plain) {
        // Keep a masked mapping for output sanitization
        this.maskedValues.set(plain, `***${key}***`);
      }
    }
  }

  /** Remove a secret by key. */
  removeSecret(key: string): boolean {
    const val = this.secrets.get(key);
    if (val !== undefined) {
      const plain = this.resolve(val);
      if (plain) this.maskedValues.delete(plain);
      this.secrets.delete(key);
      return true;
    }
    return false;
  }

  /** Clear all secrets. */
  clear(): void {
    this.secrets.clear();
    this.maskedValues.clear();
  }

  /** List registered secret keys (never exposes values). */
  listKeys(): string[] {
    return Array.from(this.secrets.keys());
  }

  /**
   * Build an env map containing ONLY secrets referenced in the command.
   * Prevents leaking all secrets to every tool invocation.
   */
  injectEnv(command: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of this.secrets) {
      // Check if command references this secret ($KEY, ${KEY}, or $KEY in shell)
      if (command.includes(key)) {
        const plain = this.resolve(value);
        if (plain) env[key] = plain;
      }
    }
    return env;
  }

  /**
   * Return ALL secrets as env map (for tools that need full access).
   * Use injectEnv() for selective injection when possible.
   */
  getAllEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of this.secrets) {
      const plain = this.resolve(value);
      if (plain) env[key] = plain;
    }
    return env;
  }

  /**
   * Mask all registered secret values in tool output.
   * Replaces every occurrence of a secret value with ***KEY***.
   */
  maskOutput(output: string): string {
    let masked = output;
    for (const [plain, replacement] of this.maskedValues) {
      if (plain.length === 0) continue;
      // Use split/join for safe string replacement (no regex escaping needed)
      masked = masked.split(plain).join(replacement);
    }
    return masked;
  }

  private resolve(value: SecretValue): string {
    if (typeof value === "string") return value;
    try {
      return (value as { getValue(): string }).getValue();
    } catch {
      return "";
    }
  }
}

/** Singleton for the worker/runtime process. */
let globalRegistry: SecretRegistry | null = null;

export function getSecretRegistry(): SecretRegistry {
  if (!globalRegistry) globalRegistry = new SecretRegistry();
  return globalRegistry;
}
