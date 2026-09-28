-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'PLATFORM_ADMIN');

-- AlterTable: Add twoFactor and platformRole to User
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "two_factor_secret" VARCHAR(255);
ALTER TABLE "users" ADD COLUMN "platform_role" "PlatformRole" NOT NULL DEFAULT 'USER';

-- CreateTable: Organization
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OrganizationMember
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organization_members_organization_id_user_id_key" UNIQUE ("organization_id", "user_id")
);

-- CreateTable: AuditLogEntry
CREATE TABLE "audit_log_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "audit_log_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100),
    "entity_id" UUID,
    "actor_user_id" UUID,
    "workspace_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ApiKey
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" VARCHAR(10) NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "api_keys_key_hash_key" UNIQUE ("key_hash")
);

-- CreateTable: FeatureFlag
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feature_flags_workspace_id_key_key" UNIQUE ("workspace_id", "key")
);

-- CreateTable: DeploymentEnvVar
CREATE TABLE "deployment_env_vars" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "environment" VARCHAR(50) NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "deployment_env_vars_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deployment_env_vars_project_id_environment_key_key" UNIQUE ("project_id", "environment", "key")
);

-- CreateTable: TaskTemplate
CREATE TABLE "task_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "goal" TEXT NOT NULL,
    "agent_mode" VARCHAR(50) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DeploymentComment
CREATE TABLE "deployment_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deployment_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CostAlert
CREATE TABLE "cost_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "threshold_type" VARCHAR(50) NOT NULL,
    "threshold_value" DOUBLE PRECISION NOT NULL,
    "period" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_triggered" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "cost_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: TaskBranch
CREATE TABLE "task_branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "parent_run_id" UUID,
    "status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProjectTeamPermission
CREATE TABLE "project_team_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission" VARCHAR(50) NOT NULL,
    "granted_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_team_permissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_team_permissions_project_id_user_id_permission_key" UNIQUE ("project_id", "user_id", "permission")
);

-- CreateTable: SsoConfig
CREATE TABLE "sso_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "client_id" TEXT,
    "client_secret" TEXT,
    "issuer_url" TEXT,
    "metadata_url" TEXT,
    "metadata_xml" TEXT,
    "domain" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "sso_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sso_configs_workspace_id_provider_key" UNIQUE ("workspace_id", "provider")
);

-- CreateTable: RateLimit
CREATE TABLE "rate_limits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID,
    "endpoint" VARCHAR(255) NOT NULL,
    "window_ms" INTEGER NOT NULL,
    "requests" INTEGER NOT NULL,
    "current_count" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rate_limits_workspace_id_user_id_endpoint_window_start_key" UNIQUE ("workspace_id", "user_id", "endpoint", "window_start")
);

-- AddForeignKey: Organization
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: OrganizationMember
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: AuditLogEntry
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_audit_log_id_fkey" FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ApiKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: FeatureFlag
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DeploymentEnvVar
ALTER TABLE "deployment_env_vars" ADD CONSTRAINT "deployment_env_vars_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: TaskTemplate
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DeploymentComment
ALTER TABLE "deployment_comments" ADD CONSTRAINT "deployment_comments_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deployment_comments" ADD CONSTRAINT "deployment_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: CostAlert
ALTER TABLE "cost_alerts" ADD CONSTRAINT "cost_alerts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: TaskBranch
ALTER TABLE "task_branches" ADD CONSTRAINT "task_branches_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ProjectTeamPermission
ALTER TABLE "project_team_permissions" ADD CONSTRAINT "project_team_permissions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_team_permissions" ADD CONSTRAINT "project_team_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: SsoConfig
ALTER TABLE "sso_configs" ADD CONSTRAINT "sso_configs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: RateLimit
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "audit_log_entries_audit_log_id_idx" ON "audit_log_entries"("audit_log_id");
CREATE INDEX "api_keys_workspace_id_idx" ON "api_keys"("workspace_id");
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");
CREATE INDEX "feature_flags_workspace_id_idx" ON "feature_flags"("workspace_id");
CREATE INDEX "deployment_env_vars_project_id_idx" ON "deployment_env_vars"("project_id");
CREATE INDEX "task_templates_workspace_id_idx" ON "task_templates"("workspace_id");
CREATE INDEX "deployment_comments_deployment_id_idx" ON "deployment_comments"("deployment_id");
CREATE INDEX "cost_alerts_workspace_id_idx" ON "cost_alerts"("workspace_id");
CREATE INDEX "task_branches_task_id_idx" ON "task_branches"("task_id");
CREATE INDEX "project_team_permissions_project_id_idx" ON "project_team_permissions"("project_id");
CREATE INDEX "project_team_permissions_user_id_idx" ON "project_team_permissions"("user_id");
CREATE INDEX "sso_configs_workspace_id_idx" ON "sso_configs"("workspace_id");
CREATE INDEX "sso_configs_domain_idx" ON "sso_configs"("domain");
CREATE INDEX "rate_limits_workspace_id_endpoint_window_start_idx" ON "rate_limits"("workspace_id", "endpoint", "window_start");
CREATE INDEX "rate_limits_user_id_endpoint_window_start_idx" ON "rate_limits"("user_id", "endpoint", "window_start");

-- AddForeignKey: Workspace -> Organization
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddReverseRelation: Workspace
ALTER TABLE "workspaces" ADD COLUMN "sso_configs" UUID[];
ALTER TABLE "workspaces" ADD COLUMN "rate_limits" UUID[];
