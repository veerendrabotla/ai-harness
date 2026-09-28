/**
 * Credentials Management System.
 * Securely stores and retrieves deployment provider credentials.
 */
import { randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret } from "@ai-harness/shared";
import type { DeploymentProviderType } from "./types.js";

export interface StoredCredential {
  id: string;
  projectId: string;
  providerType: DeploymentProviderType;
  name: string;
  encryptedValue: string;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
}

export interface CredentialManager {
  /**
   * Store a credential.
   */
  store(credential: Omit<StoredCredential, "id" | "createdAt" | "updatedAt">): Promise<StoredCredential>;

  /**
   * Get a credential by ID.
   */
  get(id: string): Promise<StoredCredential | null>;

  /**
   * Get credentials for a project and provider.
   */
  getByProjectAndProvider(projectId: string, providerType: DeploymentProviderType): Promise<StoredCredential[]>;

  /**
   * Get all credentials for a project.
   */
  getByProject(projectId: string): Promise<StoredCredential[]>;

  /**
   * Update a credential.
   */
  update(id: string, updates: Partial<Pick<StoredCredential, "encryptedValue" | "metadata" | "name">>): Promise<StoredCredential>;

  /**
   * Delete a credential.
   */
  delete(id: string): Promise<boolean>;

  /**
   * Mark a credential as used.
   */
  markUsed(id: string): Promise<void>;
}

/**
 * In-memory credential manager (for development/testing).
 * In production, use encrypted database storage.
 */
export class InMemoryCredentialManager implements CredentialManager {
  private credentials = new Map<string, StoredCredential>();

  async store(credential: Omit<StoredCredential, "id" | "createdAt" | "updatedAt">): Promise<StoredCredential> {
    const stored: StoredCredential = {
      ...credential,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.credentials.set(stored.id, stored);
    return stored;
  }

  async get(id: string): Promise<StoredCredential | null> {
    return this.credentials.get(id) ?? null;
  }

  async getByProjectAndProvider(projectId: string, providerType: DeploymentProviderType): Promise<StoredCredential[]> {
    return Array.from(this.credentials.values()).filter(
      (c) => c.projectId === projectId && c.providerType === providerType,
    );
  }

  async getByProject(projectId: string): Promise<StoredCredential[]> {
    return Array.from(this.credentials.values()).filter(
      (c) => c.projectId === projectId,
    );
  }

  async update(id: string, updates: Partial<Pick<StoredCredential, "encryptedValue" | "metadata" | "name">>): Promise<StoredCredential> {
    const credential = this.credentials.get(id);
    if (!credential) {
      throw new Error(`Credential ${id} not found`);
    }

    const updated: StoredCredential = {
      ...credential,
      ...updates,
      updatedAt: new Date(),
    };
    this.credentials.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.credentials.delete(id);
  }

  async markUsed(id: string): Promise<void> {
    const credential = this.credentials.get(id);
    if (credential) {
      credential.lastUsedAt = new Date();
    }
  }
}

/**
 * AES-256-GCM encryption for deployment credentials.
 * Uses the same encryptSecret/decryptSecret from @ai-harness/shared
 * that provider credentials use, ensuring consistent encryption at rest.
 */
export class CredentialEncryption {
  /**
   * Encrypt a credential value using AES-256-GCM.
   * @param value Plaintext credential
   * @param keyBase64 Base64-encoded 32-byte AES key (ENCRYPTION_KEY env var)
   * @returns Base64-encoded encrypted payload (iv | tag | ciphertext)
   */
  async encrypt(value: string, keyBase64: string): Promise<string> {
    const encrypted = encryptSecret(value, keyBase64);
    return encrypted.toString("base64");
  }

  /**
   * Decrypt a credential value encrypted with encrypt().
   * @param encryptedValue Base64-encoded encrypted payload
   * @param keyBase64 Base64-encoded 32-byte AES key
   * @returns Decrypted plaintext
   */
  async decrypt(encryptedValue: string, keyBase64: string): Promise<string> {
    const payload = Buffer.from(encryptedValue, "base64");
    return decryptSecret(payload, keyBase64);
  }
}
