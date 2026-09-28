/**
 * Workspace path mapping for the docker.sock sandbox layer (PHASE 13 #11).
 *
 * The worker container and the host Docker daemon see the shared workspace
 * directory at DIFFERENT absolute paths (e.g. /var/lib/ai-harness/workspaces
 * inside the container vs C:\...\Default Project\.data\workspaces on the host).
 * - worker-side FS operations (stat, materialize, temp files) use the container path
 * - `docker run -v` sources are resolved by the HOST daemon → host path
 * Pure functions so they can be unit-tested without a container.
 */
import { createHash } from "node:crypto";

function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isUnder(p: string, base: string): boolean {
  const a = norm(p);
  const b = norm(base);
  if (!b) return false;
  return a === b || a.startsWith(`${b}/`);
}

/** Container-visible path → host path the Docker daemon will resolve for -v. */
export function hostPathFor(root: string, containerDir: string, hostDir: string): string {
  if (!hostDir || !containerDir || !isUnder(root, containerDir)) return root;
  const suffix = norm(root).slice(norm(containerDir).length);
  return `${norm(hostDir)}${suffix}`;
}

/** Host path (or root reference) → path visible inside the worker container. */
export function containerPathFor(root: string, containerDir: string, hostDir: string): string {
  if (!hostDir || !containerDir || !isUnder(root, hostDir)) return root;
  const suffix = norm(root).slice(norm(hostDir).length);
  return `${norm(containerDir)}${suffix}`;
}

/** Stable per-root workspace key for materialized CLOUD project roots. */
export function workspaceKey(rootReference: string): string {
  return createHash("sha256").update(rootReference).digest("hex").slice(0, 24);
}

/** Best-effort https clone URL for `owner/repo`-style host refs (github.com/...). */
export function cloneUrlFor(rootReference: string): string | null {
  const trimmed = rootReference.replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}(\/[\w.-]+){2}$/i.test(trimmed)) return null;
  return `https://${trimmed}.git`;
}
