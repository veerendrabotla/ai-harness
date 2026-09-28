import type { ProviderConnection } from "@prisma/client";
import type { ProviderConnectionRef } from "@ai-harness/model-adapters";
import type { ProviderType } from "@ai-harness/contracts";
import { decryptSecret, getEnv } from "@ai-harness/shared";

/**
 * Builds an adapter-facing reference from a stored connection row:
 * decrypts the credential (when present — OLLAMA/OPENAI_COMPATIBLE may have none)
 * and the metadata (baseUrl, healthCheckModel, …). Never logs either value.
 */
export function buildProviderRef(conn: ProviderConnection): ProviderConnectionRef {
  const env = getEnv();
  let credential = "";
  if (conn.encryptedCredential) {
    credential = decryptSecret(Buffer.from(conn.encryptedCredential), env.ENCRYPTION_KEY);
  }
  let metadata: Record<string, string> = {};
  if (conn.encryptedMetadata) {
    try {
      const parsed: unknown = JSON.parse(
        decryptSecret(Buffer.from(conn.encryptedMetadata), env.ENCRYPTION_KEY),
      );
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, string>;
      }
    } catch {
      metadata = {};
    }
  }
  return {
    id: conn.id,
    providerType: conn.providerType as ProviderType,
    displayName: conn.displayName,
    credential,
    metadata,
  };
}
