/** Workspace role hierarchy and capability checks (PRD §5). */

export const ROLE_RANK = { VIEWER: 1, MEMBER: 2, OWNER: 3 } as const;
export type WorkspaceRoleName = keyof typeof ROLE_RANK;

export const PLATFORM_ROLE_RANK = { USER: 1, PLATFORM_ADMIN: 2 } as const;
export type PlatformRoleName = keyof typeof PLATFORM_ROLE_RANK;

export function roleAtLeast(actual: WorkspaceRoleName, required: WorkspaceRoleName): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function platformRoleAtLeast(actual: PlatformRoleName, required: PlatformRoleName): boolean {
  return PLATFORM_ROLE_RANK[actual] >= PLATFORM_ROLE_RANK[required];
}

export const CAPABILITIES = {
  WORKSPACE_UPDATE: "OWNER",
  WORKSPACE_ARCHIVE: "OWNER",
  MEMBERS_MANAGE: "OWNER",
  POLICY_UPDATE: "OWNER",
  INSTRUCTIONS_UPDATE: "OWNER",
  MODEL_ROUTES_UPDATE: "OWNER",
  MCP_ENABLE_DISABLE: "OWNER",
  PROJECT_CREATE: "MEMBER",
  TASK_CREATE: "MEMBER",
  PLAN_DECIDE: "MEMBER",
  APPROVAL_DECIDE: "MEMBER",
  CHECKPOINT_ROLLBACK: "MEMBER",
} as const;

export const PLATFORM_CAPABILITIES = {
  USER_MANAGE: "PLATFORM_ADMIN",
  WORKSPACE_MANAGE: "PLATFORM_ADMIN",
  AUDIT_VIEW: "PLATFORM_ADMIN",
  SYSTEM_CONFIG: "PLATFORM_ADMIN",
  USAGE_VIEW_ALL: "PLATFORM_ADMIN",
} as const;

export type Capability = keyof typeof CAPABILITIES;
export type PlatformCapability = keyof typeof PLATFORM_CAPABILITIES;

export function requiredRole(capability: Capability): WorkspaceRoleName {
  return CAPABILITIES[capability];
}

export function requiredPlatformRole(capability: PlatformCapability): PlatformRoleName {
  return PLATFORM_CAPABILITIES[capability];
}
