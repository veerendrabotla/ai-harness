-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('CLOUD', 'LOCAL_CONNECTED', 'HYBRID');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProjectConnectionType" AS ENUM ('CLOUD', 'LOCAL_BRIDGE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('AVAILABLE', 'DEGRADED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('READ', 'WRITE', 'DESTRUCTIVE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "PermissionDecision" AS ENUM ('ALLOW', 'ASK', 'DENY');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('ANTHROPIC', 'OPENAI', 'GOOGLE', 'OLLAMA', 'OPENAI_COMPATIBLE');

-- CreateEnum
CREATE TYPE "ProviderConnectionStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "ModelStage" AS ENUM ('PLANNING', 'IMPLEMENTATION', 'REVIEW');

-- CreateEnum
CREATE TYPE "TaskState" AS ENUM ('QUEUED', 'INITIALIZING', 'UNDERSTANDING', 'GATHERING_CONTEXT', 'PLANNING', 'WAITING_FOR_APPROVAL', 'EXECUTING', 'WAITING_FOR_TOOL_APPROVAL', 'OBSERVING', 'REPLANNING', 'VERIFYING', 'REVIEWING', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "ModelSelectionMode" AS ENUM ('MANUAL', 'ROUTED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ContextStage" AS ENUM ('PLANNING', 'IMPLEMENTATION', 'REVIEW');

-- CreateEnum
CREATE TYPE "EventActorType" AS ENUM ('USER', 'SYSTEM', 'AGENT', 'TOOL', 'BRIDGE');

-- CreateEnum
CREATE TYPE "ToolCallStatus" AS ENUM ('PENDING', 'WAITING_APPROVAL', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'DENIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalScope" AS ENUM ('ONCE', 'TASK');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApprovalRequester" AS ENUM ('AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "BridgeStatus" AS ENUM ('PENDING', 'CONNECTED', 'DEGRADED', 'DISCONNECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "McpTransportType" AS ENUM ('STDIO', 'HTTP', 'SSE');

-- CreateEnum
CREATE TYPE "McpServerStatus" AS ENUM ('DISABLED', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "CheckpointType" AS ENUM ('PRE_EXECUTION', 'MANUAL');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PASSED', 'FAILED', 'SKIPPED', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "avatar_url" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "execution_mode" "ExecutionMode" NOT NULL DEFAULT 'CLOUD',
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "bridge_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "connection_type" "ProjectConnectionType" NOT NULL DEFAULT 'CLOUD',
    "repository_url" TEXT,
    "root_reference" TEXT NOT NULL,
    "default_branch" VARCHAR(255),
    "status" "ProjectStatus" NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_instruction_versions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_instruction_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_policies" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "require_plan_approval" BOOLEAN NOT NULL DEFAULT true,
    "allow_direct_execution" BOOLEAN NOT NULL DEFAULT false,
    "max_task_duration_seconds" INTEGER NOT NULL DEFAULT 1800,
    "max_tool_calls_per_run" INTEGER NOT NULL DEFAULT 50,
    "max_subagents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspace_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_policy_rules" (
    "id" UUID NOT NULL,
    "workspace_policy_id" UUID NOT NULL,
    "tool_name" VARCHAR(120) NOT NULL,
    "action_pattern" TEXT,
    "risk_level" "RiskLevel" NOT NULL,
    "decision" "PermissionDecision" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_policy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_type" "ProviderType" NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "encrypted_credential" BYTEA,
    "encrypted_metadata" BYTEA,
    "status" "ProviderConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_provider_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider_connection_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_routes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "stage" "ModelStage" NOT NULL,
    "provider_connection_id" UUID NOT NULL,
    "model_identifier" VARCHAR(255) NOT NULL,
    "fallback_route_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "goal" TEXT NOT NULL,
    "constraints" TEXT,
    "state" "TaskState" NOT NULL DEFAULT 'QUEUED',
    "selected_model_mode" "ModelSelectionMode" NOT NULL DEFAULT 'ROUTED',
    "override_provider_connection_id" UUID,
    "override_model_identifier" VARCHAR(255),
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "pause_requested" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_runs" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "run_number" INTEGER NOT NULL,
    "state" "TaskState" NOT NULL DEFAULT 'QUEUED',
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "failure_code" VARCHAR(100),
    "failure_message" TEXT,

    CONSTRAINT "task_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_plans" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "analysis" TEXT NOT NULL,
    "affected_files" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "verification_plan" JSONB NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ,
    "approved_by" UUID,

    CONSTRAINT "task_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_packages" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "stage" "ContextStage" NOT NULL,
    "manifest" JSONB NOT NULL,
    "estimated_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "run_id" UUID,
    "sequence_number" BIGINT NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "actor_type" "EventActorType" NOT NULL DEFAULT 'SYSTEM',
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_calls" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "tool_name" VARCHAR(120) NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "input_summary" JSONB NOT NULL,
    "status" "ToolCallStatus" NOT NULL DEFAULT 'PENDING',
    "result_summary" JSONB,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "tool_call_id" UUID,
    "requested_scope" "ApprovalScope" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_actor" "ApprovalRequester" NOT NULL DEFAULT 'AGENT',
    "decided_by" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "status" "BridgeStatus" NOT NULL DEFAULT 'PENDING',
    "capabilities" JSONB,
    "last_seen_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bridges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_project_roots" (
    "id" UUID NOT NULL,
    "bridge_id" UUID NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "canonical_root_reference" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bridge_project_roots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "transport_type" "McpTransportType" NOT NULL,
    "encrypted_config" BYTEA NOT NULL,
    "status" "McpServerStatus" NOT NULL DEFAULT 'DISABLED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_mcp_servers" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "mcp_server_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkpoints" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "checkpoint_type" "CheckpointType" NOT NULL DEFAULT 'PRE_EXECUTION',
    "state_reference" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_results" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "command" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'SKIPPED',
    "output_reference" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "workspace_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_idx" ON "refresh_sessions"("user_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_expires_at_idx" ON "refresh_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "workspaces_owner_id_idx" ON "workspaces"("owner_id");

-- CreateIndex
CREATE INDEX "workspaces_status_idx" ON "workspaces"("status");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "projects_workspace_id_idx" ON "projects"("workspace_id");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_instruction_versions_workspace_id_version_key" ON "workspace_instruction_versions"("workspace_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_policies_workspace_id_key" ON "workspace_policies"("workspace_id");

-- CreateIndex
CREATE INDEX "tool_policy_rules_workspace_policy_id_tool_name_idx" ON "tool_policy_rules"("workspace_policy_id", "tool_name");

-- CreateIndex
CREATE INDEX "provider_connections_user_id_idx" ON "provider_connections"("user_id");

-- CreateIndex
CREATE INDEX "provider_connections_status_idx" ON "provider_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_provider_connections_workspace_id_provider_connec_key" ON "workspace_provider_connections"("workspace_id", "provider_connection_id");

-- CreateIndex
CREATE INDEX "model_routes_workspace_id_stage_active_idx" ON "model_routes"("workspace_id", "stage", "active");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_state_idx" ON "tasks"("workspace_id", "state");

-- CreateIndex
CREATE INDEX "tasks_project_id_idx" ON "tasks"("project_id");

-- CreateIndex
CREATE INDEX "tasks_created_by_idx" ON "tasks"("created_by");

-- CreateIndex
CREATE INDEX "tasks_state_idx" ON "tasks"("state");

-- CreateIndex
CREATE INDEX "task_runs_task_id_idx" ON "task_runs"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_runs_task_id_run_number_key" ON "task_runs"("task_id", "run_number");

-- CreateIndex
CREATE INDEX "task_plans_task_id_status_idx" ON "task_plans"("task_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "task_plans_task_id_version_key" ON "task_plans"("task_id", "version");

-- CreateIndex
CREATE INDEX "context_packages_task_id_run_id_idx" ON "context_packages"("task_id", "run_id");

-- CreateIndex
CREATE INDEX "task_events_task_id_sequence_number_idx" ON "task_events"("task_id", "sequence_number");

-- CreateIndex
CREATE INDEX "task_events_event_type_idx" ON "task_events"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "task_events_task_id_sequence_number_key" ON "task_events"("task_id", "sequence_number");

-- CreateIndex
CREATE INDEX "tool_calls_task_id_run_id_idx" ON "tool_calls"("task_id", "run_id");

-- CreateIndex
CREATE INDEX "tool_calls_status_idx" ON "tool_calls"("status");

-- CreateIndex
CREATE INDEX "approval_requests_task_id_status_idx" ON "approval_requests"("task_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_status_expires_at_idx" ON "approval_requests"("status", "expires_at");

-- CreateIndex
CREATE INDEX "bridges_user_id_idx" ON "bridges"("user_id");

-- CreateIndex
CREATE INDEX "bridges_status_idx" ON "bridges"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bridge_project_roots_bridge_id_canonical_root_reference_key" ON "bridge_project_roots"("bridge_id", "canonical_root_reference");

-- CreateIndex
CREATE INDEX "mcp_servers_owner_id_idx" ON "mcp_servers"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_mcp_servers_workspace_id_mcp_server_id_key" ON "workspace_mcp_servers"("workspace_id", "mcp_server_id");

-- CreateIndex
CREATE INDEX "checkpoints_task_id_idx" ON "checkpoints"("task_id");

-- CreateIndex
CREATE INDEX "verification_results_task_id_run_id_idx" ON "verification_results"("task_id", "run_id");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_created_at_idx" ON "audit_logs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_bridge_id_fkey" FOREIGN KEY ("bridge_id") REFERENCES "bridges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_instruction_versions" ADD CONSTRAINT "workspace_instruction_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_instruction_versions" ADD CONSTRAINT "workspace_instruction_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_policies" ADD CONSTRAINT "workspace_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_policy_rules" ADD CONSTRAINT "tool_policy_rules_workspace_policy_id_fkey" FOREIGN KEY ("workspace_policy_id") REFERENCES "workspace_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_provider_connections" ADD CONSTRAINT "workspace_provider_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_provider_connections" ADD CONSTRAINT "workspace_provider_connections_provider_connection_id_fkey" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_provider_connection_id_fkey" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_fallback_route_id_fkey" FOREIGN KEY ("fallback_route_id") REFERENCES "model_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_override_provider_connection_id_fkey" FOREIGN KEY ("override_provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_packages" ADD CONSTRAINT "context_packages_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tool_call_id_fkey" FOREIGN KEY ("tool_call_id") REFERENCES "tool_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridges" ADD CONSTRAINT "bridges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_project_roots" ADD CONSTRAINT "bridge_project_roots_bridge_id_fkey" FOREIGN KEY ("bridge_id") REFERENCES "bridges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_mcp_servers" ADD CONSTRAINT "workspace_mcp_servers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_mcp_servers" ADD CONSTRAINT "workspace_mcp_servers_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
