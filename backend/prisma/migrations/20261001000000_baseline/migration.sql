-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('CLOUD', 'LOCAL_CONNECTED', 'HYBRID');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "ProjectConnectionType" AS ENUM ('CLOUD', 'LOCAL_BRIDGE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('AVAILABLE', 'DEGRADED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('READ', 'WRITE', 'DESTRUCTIVE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "PermissionDecision" AS ENUM ('ALLOW', 'ASK', 'DENY');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('ANTHROPIC', 'OPENAI', 'GOOGLE', 'OLLAMA', 'OPENAI_COMPATIBLE', 'TEST');

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
CREATE TYPE "AgentMode" AS ENUM ('BUILD', 'PLAN', 'ASK', 'REVIEW', 'FIX');

-- CreateEnum
CREATE TYPE "McpServerStatus" AS ENUM ('DISABLED', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "CheckpointType" AS ENUM ('PRE_EXECUTION', 'MANUAL');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PASSED', 'FAILED', 'SKIPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "MemoryCategory" AS ENUM ('architecture_decision', 'coding_convention', 'previous_bug', 'user_preference', 'deployment_config', 'recurring_failure', 'lesson_learned', 'file_pattern', 'dependency_note', 'performance_note');

-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('agent_observation', 'user_input', 'code_analysis', 'error_pattern');

-- CreateEnum
CREATE TYPE "DeploymentEnv" AS ENUM ('production', 'preview', 'staging');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('QUEUED', 'PREPARING', 'BUILDING', 'DEPLOYING', 'HEALTH_CHECKING', 'READY', 'FAILED', 'CANCELLED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "WebhookSubStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DEAD');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "DeploymentProviderType" AS ENUM ('self_hosted', 'vercel', 'netlify', 'cloudflare', 'railway', 'render');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'BOUNCED', 'COMPLAINT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'TRIALING', 'UNPAID', 'PAUSED');

-- CreateEnum
CREATE TYPE "KnowledgeEntryType" AS ENUM ('DOCUMENT', 'CODE_SNIPPET', 'LINK', 'NOTE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "avatar_url" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "platform_role" "PlatformRole" NOT NULL DEFAULT 'USER',
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_secret" TEXT,
    "notification_preferences" JSONB DEFAULT '{"email":true}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "organization_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "execution_mode" "ExecutionMode" NOT NULL DEFAULT 'CLOUD',
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "ip_allowlist" TEXT[],
    "ip_allowlist_enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhook_urls" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "deployment_protection" JSONB,
    "webhook_secret" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_instruction_versions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "block_on_review_findings" BOOLEAN NOT NULL DEFAULT false,

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_provider_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider_connection_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "agent_mode" "AgentMode" NOT NULL DEFAULT 'BUILD',
    "archived_at" TIMESTAMPTZ(6),
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "parent_task_id" UUID,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_runs" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "run_number" INTEGER NOT NULL,
    "state" "TaskState" NOT NULL DEFAULT 'QUEUED',
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "failure_code" VARCHAR(100),
    "failure_message" TEXT,
    "input_tokens" INTEGER DEFAULT 0,
    "output_tokens" INTEGER DEFAULT 0,
    "total_tokens" INTEGER DEFAULT 0,
    "estimated_cost" DOUBLE PRECISION DEFAULT 0,
    "model_used" VARCHAR(255),

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

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
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

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
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_token_hash" TEXT,

    CONSTRAINT "bridges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_project_roots" (
    "id" UUID NOT NULL,
    "bridge_id" UUID NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "canonical_root_reference" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "discovered_tools" JSONB,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_mcp_servers" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "mcp_server_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invites" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "token_hash" TEXT NOT NULL,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_exports" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "exported_by" UUID NOT NULL,
    "exported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "package_json" JSONB NOT NULL,

    CONSTRAINT "session_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_shares" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "shared_by" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "permission" VARCHAR(50) NOT NULL DEFAULT 'view_only',
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "project_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "conversation" JSONB NOT NULL DEFAULT '[]',
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "plans" JSONB NOT NULL DEFAULT '[]',
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "files_changed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checkpoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model_info" JSONB NOT NULL DEFAULT '{}',
    "execution_provider" TEXT NOT NULL DEFAULT 'unknown',
    "agent_state" JSONB NOT NULL DEFAULT '{}',
    "verification" JSONB NOT NULL DEFAULT '{}',
    "deployment" JSONB,
    "memory_references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forked_from" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_traces" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "goal" TEXT NOT NULL,
    "reasoning" JSONB NOT NULL DEFAULT '[]',
    "plan" JSONB NOT NULL DEFAULT '[]',
    "executions" JSONB NOT NULL DEFAULT '[]',
    "observations" JSONB NOT NULL DEFAULT '[]',
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "verification" JSONB NOT NULL DEFAULT '[]',
    "outcome" JSONB NOT NULL DEFAULT '{}',
    "token_usage" JSONB NOT NULL DEFAULT '{}',
    "duration" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "execution_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_memories" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "category" "MemoryCategory" NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "value" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source" "MemorySource" NOT NULL DEFAULT 'agent_observation',
    "references" JSONB NOT NULL DEFAULT '[]',
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_accessed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID,
    "checkpoint_id" UUID,
    "created_by" UUID NOT NULL,
    "environment" "DeploymentEnv" NOT NULL DEFAULT 'production',
    "status" "DeploymentStatus" NOT NULL DEFAULT 'QUEUED',
    "build_command" TEXT NOT NULL DEFAULT 'npm run build',
    "output_dir" TEXT,
    "deployment_url" TEXT,
    "preview_url" TEXT,
    "build_logs" TEXT,
    "runtime_logs" TEXT,
    "source_revision" VARCHAR(255),
    "source_branch" VARCHAR(255),
    "failure_reason" TEXT,
    "rollback_of_id" UUID,
    "metadata" JSONB,
    "started_at" TIMESTAMPTZ(6),
    "build_completed_at" TIMESTAMPTZ(6),
    "deployed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_secrets" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "provider_type" "DeploymentProviderType" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deployment_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "workspace_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "metadata" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID,
    "task_id" UUID,
    "provider_type" VARCHAR(50) NOT NULL,
    "model_identifier" VARCHAR(255) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stage" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" VARCHAR(10) NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_env_vars" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "environment" VARCHAR(50) NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deployment_env_vars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_templates" (
    "id" UUID NOT NULL,
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

-- CreateTable
CREATE TABLE "deployment_comments" (
    "id" UUID NOT NULL,
    "deployment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_alerts" (
    "id" UUID NOT NULL,
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

-- CreateTable
CREATE TABLE "task_branches" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "parent_run_id" UUID,
    "status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_team_permissions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission" VARCHAR(50) NOT NULL,
    "granted_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_team_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "metadata" JSONB,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "event_types" TEXT[],
    "secret" VARCHAR(255),
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "status" "WebhookSubStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery_logs" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "next_retry_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_configs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "client_id" TEXT,
    "client_secret" TEXT,
    "issuer_url" TEXT,
    "metadata_url" TEXT,
    "metadata_xml" TEXT,
    "idp_certificate" TEXT,
    "domain" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sso_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID,
    "endpoint" VARCHAR(255) NOT NULL,
    "window_ms" INTEGER NOT NULL,
    "requests" INTEGER NOT NULL,
    "current_count" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_versions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "path" VARCHAR(1024) NOT NULL,
    "version" INTEGER NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "mime_type" VARCHAR(255),
    "content_hash" VARCHAR(64) NOT NULL,
    "uploaded_by" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "recipient_email" VARCHAR(320) NOT NULL,
    "template_type" VARCHAR(100) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "workspace_id" UUID,
    "metadata" JSONB,
    "external_id" VARCHAR(255),
    "error_message" TEXT,
    "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "opened_at" TIMESTAMPTZ(6),
    "bounced_at" TIMESTAMPTZ(6),
    "complaint_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_unsubscribes" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "unsubscribe_type" VARCHAR(100) NOT NULL,
    "workspace_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_unsubscribes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "stripe_customer_id" VARCHAR(255),
    "stripe_subscription_id" VARCHAR(255),
    "stripe_price_id" VARCHAR(255),
    "stripe_session_id" VARCHAR(255),
    "plan" VARCHAR(50) NOT NULL DEFAULT 'free',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_period_start" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "trial_start" TIMESTAMPTZ(6),
    "trial_end" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_backups" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_domains" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    "verification_token" VARCHAR(255) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_retention_settings" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_retention_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_entries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "type" "KnowledgeEntryType" NOT NULL DEFAULT 'NOTE',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webcontainer_sessions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'CREATING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webcontainer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webcontainer_settings" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webcontainer_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_health_checks" (
    "id" UUID NOT NULL,
    "provider_connection_id" UUID NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_health_checks_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "workspaces_organization_id_idx" ON "workspaces"("organization_id");

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
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks"("parent_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_runs_task_id_run_number_key" ON "task_runs"("task_id", "run_number");

-- CreateIndex
CREATE INDEX "task_plans_task_id_status_idx" ON "task_plans"("task_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "task_plans_task_id_version_key" ON "task_plans"("task_id", "version");

-- CreateIndex
CREATE INDEX "context_packages_task_id_run_id_idx" ON "context_packages"("task_id", "run_id");

-- CreateIndex
CREATE INDEX "task_events_event_type_idx" ON "task_events"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "task_events_task_id_sequence_number_key" ON "task_events"("task_id", "sequence_number");

-- CreateIndex
CREATE INDEX "tool_calls_task_id_run_id_idx" ON "tool_calls"("task_id", "run_id");

-- CreateIndex
CREATE INDEX "tool_calls_run_id_idx" ON "tool_calls"("run_id");

-- CreateIndex
CREATE INDEX "tool_calls_status_idx" ON "tool_calls"("status");

-- CreateIndex
CREATE INDEX "approval_requests_task_id_status_idx" ON "approval_requests"("task_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_status_expires_at_idx" ON "approval_requests"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "bridges_device_token_hash_key" ON "bridges"("device_token_hash");

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

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invites_token_hash_key" ON "workspace_invites"("token_hash");

-- CreateIndex
CREATE INDEX "workspace_invites_workspace_id_idx" ON "workspace_invites"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_invites_email_idx" ON "workspace_invites"("email");

-- CreateIndex
CREATE INDEX "workspace_invites_invited_by_idx" ON "workspace_invites"("invited_by");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invites_workspace_id_email_key" ON "workspace_invites"("workspace_id", "email");

-- CreateIndex
CREATE INDEX "session_exports_task_id_idx" ON "session_exports"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_shares_token_hash_key" ON "session_shares"("token_hash");

-- CreateIndex
CREATE INDEX "session_shares_task_id_idx" ON "session_shares"("task_id");

-- CreateIndex
CREATE INDEX "session_shares_token_hash_idx" ON "session_shares"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_project_id_idx" ON "sessions"("project_id");

-- CreateIndex
CREATE INDEX "sessions_workspace_id_idx" ON "sessions"("workspace_id");

-- CreateIndex
CREATE INDEX "sessions_status_idx" ON "sessions"("status");

-- CreateIndex
CREATE INDEX "sessions_created_at_idx" ON "sessions"("created_at");

-- CreateIndex
CREATE INDEX "execution_traces_task_id_created_at_idx" ON "execution_traces"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "project_memories_project_id_category_idx" ON "project_memories"("project_id", "category");

-- CreateIndex
CREATE INDEX "project_memories_project_id_key_idx" ON "project_memories"("project_id", "key");

-- CreateIndex
CREATE INDEX "deployments_project_id_created_at_idx" ON "deployments"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "deployments_status_idx" ON "deployments"("status");

-- CreateIndex
CREATE INDEX "deployments_task_id_idx" ON "deployments"("task_id");

-- CreateIndex
CREATE INDEX "deployment_secrets_project_id_idx" ON "deployment_secrets"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_secrets_project_id_provider_type_name_key" ON "deployment_secrets"("project_id", "provider_type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_owner_id_idx" ON "organizations"("owner_id");

-- CreateIndex
CREATE INDEX "organizations_slug_idx" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_log_entries_user_id_idx" ON "audit_log_entries"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_entries_workspace_id_idx" ON "audit_log_entries"("workspace_id");

-- CreateIndex
CREATE INDEX "audit_log_entries_action_idx" ON "audit_log_entries"("action");

-- CreateIndex
CREATE INDEX "audit_log_entries_entity_type_idx" ON "audit_log_entries"("entity_type");

-- CreateIndex
CREATE INDEX "audit_log_entries_created_at_idx" ON "audit_log_entries"("created_at");

-- CreateIndex
CREATE INDEX "usage_records_user_id_idx" ON "usage_records"("user_id");

-- CreateIndex
CREATE INDEX "usage_records_workspace_id_idx" ON "usage_records"("workspace_id");

-- CreateIndex
CREATE INDEX "usage_records_model_identifier_idx" ON "usage_records"("model_identifier");

-- CreateIndex
CREATE INDEX "usage_records_created_at_idx" ON "usage_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_workspace_id_idx" ON "api_keys"("workspace_id");

-- CreateIndex
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_workspace_id_key_key" ON "feature_flags"("workspace_id", "key");

-- CreateIndex
CREATE INDEX "deployment_env_vars_project_id_idx" ON "deployment_env_vars"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_env_vars_project_id_environment_key_key" ON "deployment_env_vars"("project_id", "environment", "key");

-- CreateIndex
CREATE INDEX "task_templates_workspace_id_idx" ON "task_templates"("workspace_id");

-- CreateIndex
CREATE INDEX "deployment_comments_deployment_id_idx" ON "deployment_comments"("deployment_id");

-- CreateIndex
CREATE INDEX "cost_alerts_workspace_id_idx" ON "cost_alerts"("workspace_id");

-- CreateIndex
CREATE INDEX "task_branches_task_id_idx" ON "task_branches"("task_id");

-- CreateIndex
CREATE INDEX "project_team_permissions_project_id_idx" ON "project_team_permissions"("project_id");

-- CreateIndex
CREATE INDEX "project_team_permissions_user_id_idx" ON "project_team_permissions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_team_permissions_project_id_user_id_permission_key" ON "project_team_permissions"("project_id", "user_id", "permission");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_workspace_id_status_idx" ON "webhook_subscriptions"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "webhook_delivery_logs_subscription_id_status_idx" ON "webhook_delivery_logs"("subscription_id", "status");

-- CreateIndex
CREATE INDEX "webhook_delivery_logs_status_next_retry_at_idx" ON "webhook_delivery_logs"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "sso_configs_workspace_id_idx" ON "sso_configs"("workspace_id");

-- CreateIndex
CREATE INDEX "sso_configs_domain_idx" ON "sso_configs"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "sso_configs_workspace_id_provider_key" ON "sso_configs"("workspace_id", "provider");

-- CreateIndex
CREATE INDEX "rate_limits_workspace_id_endpoint_window_start_idx" ON "rate_limits"("workspace_id", "endpoint", "window_start");

-- CreateIndex
CREATE INDEX "rate_limits_user_id_endpoint_window_start_idx" ON "rate_limits"("user_id", "endpoint", "window_start");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_workspace_id_user_id_endpoint_window_start_key" ON "rate_limits"("workspace_id", "user_id", "endpoint", "window_start");

-- CreateIndex
CREATE INDEX "file_versions_project_id_path_idx" ON "file_versions"("project_id", "path");

-- CreateIndex
CREATE INDEX "file_versions_project_id_idx" ON "file_versions"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_project_id_path_version_key" ON "file_versions"("project_id", "path", "version");

-- CreateIndex
CREATE INDEX "email_deliveries_recipient_email_idx" ON "email_deliveries"("recipient_email");

-- CreateIndex
CREATE INDEX "email_deliveries_workspace_id_idx" ON "email_deliveries"("workspace_id");

-- CreateIndex
CREATE INDEX "email_deliveries_status_idx" ON "email_deliveries"("status");

-- CreateIndex
CREATE INDEX "email_deliveries_template_type_idx" ON "email_deliveries"("template_type");

-- CreateIndex
CREATE INDEX "email_deliveries_created_at_idx" ON "email_deliveries"("created_at");

-- CreateIndex
CREATE INDEX "email_unsubscribes_email_idx" ON "email_unsubscribes"("email");

-- CreateIndex
CREATE INDEX "email_unsubscribes_workspace_id_idx" ON "email_unsubscribes"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_unsubscribes_email_unsubscribe_type_key" ON "email_unsubscribes"("email", "unsubscribe_type");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_workspace_id_key" ON "subscriptions"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_customer_id_key" ON "subscriptions"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_session_id_key" ON "subscriptions"("stripe_session_id");

-- CreateIndex
CREATE INDEX "subscriptions_stripe_customer_id_idx" ON "subscriptions"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "subscriptions_stripe_subscription_id_idx" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "workspace_backups_workspace_id_created_at_idx" ON "workspace_backups"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "organization_settings_organization_id_key" ON "organization_settings"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_domains_organization_id_domain_key" ON "organization_domains"("organization_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "audit_retention_settings_workspace_id_key" ON "audit_retention_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "knowledge_entries_workspace_id_type_idx" ON "knowledge_entries"("workspace_id", "type");

-- CreateIndex
CREATE INDEX "knowledge_entries_workspace_id_created_at_idx" ON "knowledge_entries"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "webcontainer_sessions_workspace_id_status_idx" ON "webcontainer_sessions"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "webcontainer_sessions_expires_at_idx" ON "webcontainer_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "webcontainer_settings_workspace_id_key" ON "webcontainer_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "provider_health_checks_provider_connection_id_checked_at_idx" ON "provider_health_checks"("provider_connection_id", "checked_at");

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_bridge_id_fkey" FOREIGN KEY ("bridge_id") REFERENCES "bridges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_instruction_versions" ADD CONSTRAINT "workspace_instruction_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_instruction_versions" ADD CONSTRAINT "workspace_instruction_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_policies" ADD CONSTRAINT "workspace_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_policy_rules" ADD CONSTRAINT "tool_policy_rules_workspace_policy_id_fkey" FOREIGN KEY ("workspace_policy_id") REFERENCES "workspace_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_provider_connections" ADD CONSTRAINT "workspace_provider_connections_provider_connection_id_fkey" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_provider_connections" ADD CONSTRAINT "workspace_provider_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_fallback_route_id_fkey" FOREIGN KEY ("fallback_route_id") REFERENCES "model_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_provider_connection_id_fkey" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_override_provider_connection_id_fkey" FOREIGN KEY ("override_provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_packages" ADD CONSTRAINT "context_packages_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tool_call_id_fkey" FOREIGN KEY ("tool_call_id") REFERENCES "tool_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridges" ADD CONSTRAINT "bridges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_project_roots" ADD CONSTRAINT "bridge_project_roots_bridge_id_fkey" FOREIGN KEY ("bridge_id") REFERENCES "bridges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_mcp_servers" ADD CONSTRAINT "workspace_mcp_servers_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_mcp_servers" ADD CONSTRAINT "workspace_mcp_servers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_exports" ADD CONSTRAINT "session_exports_exported_by_fkey" FOREIGN KEY ("exported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_exports" ADD CONSTRAINT "session_exports_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_shares" ADD CONSTRAINT "session_shares_shared_by_fkey" FOREIGN KEY ("shared_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_shares" ADD CONSTRAINT "session_shares_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_traces" ADD CONSTRAINT "execution_traces_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memories" ADD CONSTRAINT "project_memories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "checkpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_rollback_of_id_fkey" FOREIGN KEY ("rollback_of_id") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_secrets" ADD CONSTRAINT "deployment_secrets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_env_vars" ADD CONSTRAINT "deployment_env_vars_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_comments" ADD CONSTRAINT "deployment_comments_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_comments" ADD CONSTRAINT "deployment_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_alerts" ADD CONSTRAINT "cost_alerts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_branches" ADD CONSTRAINT "task_branches_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_team_permissions" ADD CONSTRAINT "project_team_permissions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_team_permissions" ADD CONSTRAINT "project_team_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery_logs" ADD CONSTRAINT "webhook_delivery_logs_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_configs" ADD CONSTRAINT "sso_configs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_backups" ADD CONSTRAINT "workspace_backups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_retention_settings" ADD CONSTRAINT "audit_retention_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webcontainer_sessions" ADD CONSTRAINT "webcontainer_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webcontainer_settings" ADD CONSTRAINT "webcontainer_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_health_checks" ADD CONSTRAINT "provider_health_checks_provider_connection_id_fkey" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
