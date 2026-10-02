import type { PolicySnapshot, PermissionDecisionResult, PermissionRequest } from "./types.js";

/**
 * Permission Engine (AGENT_RUNTIME.md §12).
 *
 * Evaluation order:
 *  1. Explicit DENY rules always win.
 *  2. A live TASK-scope approval for the same tool grants ALLOW (ONCE scope is
 *     consumed by the caller before invocation and is not modeled here).
 *  3. Most-specific matching rule (exact tool name, then wildcard pattern) decides.
 *  4. Safe defaults when no rule matches — READ flows through, anything that can
 *     mutate or reach outside requires approval. Destructive defaults to ASK even
 *     when a WRITE ALLOW rule exists (defense-in-depth, no silent escalation).
 */

const DEFAULT_BY_RISK: Record<string, { outcome: "ALLOW" | "ASK"; reason: string }> = {
  READ: { outcome: "ALLOW", reason: "No matching rule; READ tools are allowed by default" },
  WRITE: { outcome: "ASK", reason: "No matching rule; WRITE tools require approval by default" },
  DESTRUCTIVE: {
    outcome: "ASK",
    reason: "No matching rule; DESTRUCTIVE tools require approval by default",
  },
  EXTERNAL: {
    outcome: "ASK",
    reason: "No matching rule; EXTERNAL tools require approval by default",
  },
};

function wildcardMatch(pattern: string, toolName: string): boolean {
  if (!pattern.includes("*")) return false;
  const regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === "*" ? ".*" : `\\${m}`))}$`);
  return regex.test(toolName);
}

function isSensitiveEnvPath(resourcePath: string | undefined): boolean {
  if (!resourcePath) return false;
  const base = resourcePath.split("/").pop()?.split("\\").pop() ?? resourcePath;
  return base === ".env" || base.startsWith(".env.");
}

/**
 * Repo-wiki zone: `.aiharness/wiki/` holds auto-maintained living docs, so
 * writes there are pre-approved (runs keep docs fresh without parking for
 * approval). Constraints that keep this safe:
 *  - explicit policy rules above (DENY / ASK) still win;
 *  - the `.env` escalation still wins (no `.env` sneaks in via the wiki dir);
 *  - executors hard-confine these paths to the project root
 *    (bridge `confinePath`, sandbox `sanitizeRel`), and nothing reads the wiki
 *    back into context (see docs/guides/wiki.md).
 */
function isWikiZonePath(resourcePath: string | undefined): boolean {
  if (!resourcePath) return false;
  const norm = resourcePath.replace(/\\/g, "/");
  if (norm.split("/").includes("..")) return false;
  return norm === ".aiharness/wiki" || norm.startsWith(".aiharness/wiki/");
}

function getRequestPath(request: PermissionRequest): string | undefined {
  return request.resourcePath ?? request.path;
}

export function evaluatePermission(
  snapshot: PolicySnapshot,
  request: PermissionRequest,
): PermissionDecisionResult {
  const rules = snapshot.rules ?? [];

  const deny = rules.find(
    (r) => r.decision === "DENY" && ruleMatches(r.toolName, request.toolName),
  );
  if (deny) {
    return {
      outcome: "DENY",
      reason: `Denied by explicit policy rule for ${deny.toolName}`,
      matchedRuleId: deny.id,
    };
  }

  // Per-file guard: .env* writes require explicit approval even if policy says ALLOW
  const isEnvWrite =
    (request.toolName === "filesystem.write" || request.toolName === "filesystem.create") &&
    isSensitiveEnvPath(getRequestPath(request));

  if (request.approvals?.taskScopeToolNames?.includes(request.toolName)) {
    // TASK-scope approval overrides .env guard — human explicitly approved
    return {
      outcome: "ALLOW",
      reason: isEnvWrite
        ? "Covered by an active TASK-scope approval (including .env target)"
        : "Covered by an active TASK-scope approval",
      matchedRuleId: null,
    };
  }

  const exact = rules.find(
    (r) =>
      r.decision !== "DENY" &&
      r.toolName === request.toolName &&
      (!r.actionPattern || r.actionPattern === "*" || wildcardMatch(r.actionPattern, request.toolName)),
  );
  if (exact && exact.decision !== "DENY") {
    // Defense-in-depth: an ALLOW rule may not silently auto-approve destructive risk.
    if (exact.decision === "ALLOW" && exact.riskLevel === "DESTRUCTIVE") {
      return {
        outcome: "ASK",
        reason: "ALLOW rule matched but DESTRUCTIVE risk still requires approval",
        matchedRuleId: exact.id,
      };
    }
    // Per-file .env guard: escalate ALLOW to ASK for sensitive env writes
    if (exact.decision === "ALLOW" && isEnvWrite) {
      return {
        outcome: "ASK",
        reason: "Sensitive .env file requires approval — escalated from ALLOW to ASK",
        matchedRuleId: exact.id,
      };
    }
    return {
      outcome: exact.decision,
      reason: `Matched policy rule for ${exact.toolName}`,
      matchedRuleId: exact.id,
    };
  }

  const wildcard = rules.find(
    (r) => r.decision !== "DENY" && r.actionPattern && wildcardMatch(r.actionPattern, request.toolName),
  );
  if (wildcard) {
    if (wildcard.decision === "ALLOW" && isEnvWrite) {
      return {
        outcome: "ASK",
        reason: "Sensitive .env file requires approval — escalated from ALLOW to ASK",
        matchedRuleId: wildcard.id,
      };
    }
    return {
      outcome: wildcard.decision,
      reason: `Matched pattern ${wildcard.actionPattern}`,
      matchedRuleId: wildcard.id,
    };
  }

  // Repo-wiki pre-approval (after explicit rules so policy can still constrain,
  // before risk defaults so wiki writes do not park runs for approval).
  if (
    (request.toolName === "filesystem.write" || request.toolName === "filesystem.create") &&
    !isEnvWrite &&
    isWikiZonePath(getRequestPath(request))
  ) {
    return {
      outcome: "ALLOW",
      reason: "Pre-approved repo-wiki zone (.aiharness/wiki/)",
      matchedRuleId: null,
    };
  }

  const fallback = DEFAULT_BY_RISK[request.riskLevel] ?? DEFAULT_BY_RISK["EXTERNAL"]!;
  if (fallback.outcome === "ALLOW" && isEnvWrite) {
    return {
      outcome: "ASK",
      reason: "Sensitive .env file requires approval — escalated from ALLOW to ASK",
      matchedRuleId: null,
    };
  }
  return { outcome: fallback.outcome, reason: fallback.reason, matchedRuleId: null };
}

function ruleMatches(ruleToolName: string, toolName: string): boolean {
  return ruleToolName === toolName || wildcardMatch(ruleToolName, toolName);
}
