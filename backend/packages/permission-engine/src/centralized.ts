/**
 * Centralized Permission Engine for AI Harness.
 * Covers tool execution, file operations, git operations, deployment, and admin actions.
 */

export type ResourceType = "tool" | "file" | "git" | "deployment" | "admin" | "memory" | "mcp" | "secret";
export type ActionType = "read" | "write" | "delete" | "execute" | "push" | "deploy" | "admin";
export type ToolRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface CentralizedPermissionRequest {
  resource: ResourceType;
  action: ActionType;
  riskLevel: ToolRiskLevel;
  resourceId?: string;
  taskId?: string;
  projectId?: string;
  workspaceId?: string;
  userId?: string;
  userRole?: string;
  environment?: "sandbox" | "bridge" | "remote";
  metadata?: Record<string, unknown>;
}

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  expiresAt?: Date;
  conditions?: string[];
}

export interface PermissionPolicy {
  id: string;
  name: string;
  resource: ResourceType;
  action: ActionType;
  decision: "allow" | "deny" | "approval-required";
  riskLevel?: ToolRiskLevel;
  userRoles?: string[];
  environments?: string[];
  conditions?: string[];
  priority: number;
}

const DEFAULT_POLICIES: PermissionPolicy[] = [
  { id: "file-read", name: "File Read", resource: "file", action: "read", decision: "allow", priority: 100 },
  { id: "file-write", name: "File Write", resource: "file", action: "write", decision: "allow", riskLevel: "LOW", priority: 100 },
  { id: "file-delete", name: "File Delete", resource: "file", action: "delete", decision: "approval-required", riskLevel: "HIGH", priority: 100 },
  { id: "git-commit", name: "Git Commit", resource: "git", action: "execute", decision: "allow", riskLevel: "LOW", priority: 100 },
  { id: "git-push", name: "Git Push", resource: "git", action: "push", decision: "approval-required", riskLevel: "HIGH", priority: 100 },
  { id: "git-force-push", name: "Git Force Push", resource: "git", action: "push", decision: "deny", riskLevel: "CRITICAL", priority: 200 },
  { id: "terminal-safe", name: "Terminal Safe Commands", resource: "tool", action: "execute", decision: "allow", riskLevel: "LOW", priority: 100 },
  { id: "terminal-risky", name: "Terminal Risky Commands", resource: "tool", action: "execute", decision: "approval-required", riskLevel: "HIGH", priority: 100 },
  { id: "terminal-destructive", name: "Terminal Destructive", resource: "tool", action: "execute", decision: "deny", riskLevel: "CRITICAL", priority: 200 },
  { id: "deploy", name: "Deployment", resource: "deployment", action: "deploy", decision: "approval-required", riskLevel: "HIGH", priority: 100 },
  { id: "secret-read", name: "Secret Read", resource: "secret", action: "read", decision: "allow", riskLevel: "MEDIUM", priority: 100 },
  { id: "secret-write", name: "Secret Write", resource: "secret", action: "write", decision: "approval-required", riskLevel: "HIGH", priority: 100 },
  { id: "secret-delete", name: "Secret Delete", resource: "secret", action: "delete", decision: "approval-required", riskLevel: "CRITICAL", priority: 100 },
  { id: "admin", name: "Admin Operations", resource: "admin", action: "admin", decision: "approval-required", riskLevel: "CRITICAL", priority: 100 },
  { id: "memory-write", name: "Memory Write", resource: "memory", action: "write", decision: "allow", riskLevel: "LOW", priority: 100 },
  { id: "memory-delete", name: "Memory Delete", resource: "memory", action: "delete", decision: "approval-required", riskLevel: "MEDIUM", priority: 100 },
];

export class CentralizedPermissionEngine {
  private policies: PermissionPolicy[];

  constructor(additionalPolicies: PermissionPolicy[] = []) {
    this.policies = [...DEFAULT_POLICIES, ...additionalPolicies];
    this.policies.sort((a, b) => b.priority - a.priority);
  }

  evaluate(request: CentralizedPermissionRequest): PermissionDecision {
    const matching = this.policies.filter(p =>
      p.resource === request.resource &&
      p.action === request.action &&
      (!p.riskLevel || p.riskLevel === request.riskLevel) &&
      (!p.userRoles || !request.userRole || p.userRoles.includes(request.userRole)) &&
      (!p.environments || !request.environment || p.environments.includes(request.environment))
    );

    if (matching.length === 0) {
      return { allowed: false, reason: "No matching policy", requiresApproval: false };
    }

    const deny = matching.find(p => p.decision === "deny");
    if (deny) return { allowed: false, reason: `Denied by policy: ${deny.name}`, requiresApproval: false };

    const approval = matching.find(p => p.decision === "approval-required");
    if (approval) return { allowed: false, reason: `Requires approval: ${approval.name}`, requiresApproval: true };

    const allow = matching.find(p => p.decision === "allow");
    if (allow) return { allowed: true, reason: `Allowed by policy: ${allow.name}`, requiresApproval: false };

    return { allowed: false, reason: "No allow policy matched", requiresApproval: false };
  }

  addPolicy(policy: PermissionPolicy): void {
    this.policies.push(policy);
    this.policies.sort((a, b) => b.priority - a.priority);
  }

  removePolicy(policyId: string): void {
    this.policies = this.policies.filter(p => p.id !== policyId);
  }
}
