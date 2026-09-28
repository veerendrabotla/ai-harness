-- Migration: Add 2FA and Platform Admin support
-- Run: npx prisma migrate dev --name add-2fa-and-platform-admin

-- Add PlatformRole enum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'PLATFORM_ADMIN');

-- Add platform role and 2FA fields to users table
ALTER TABLE "users" ADD COLUMN "platform_role" "PlatformRole" NOT NULL DEFAULT 'USER';
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "two_factor_secret" TEXT;

-- Create index for platform role queries
CREATE INDEX "idx_users_platform_role" ON "users"("platform_role");

-- Add organization model for team hierarchy
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- Create unique index for organization slug
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- Create organization members table
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint for organization membership
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- Add organization_id to workspaces
ALTER TABLE "workspaces" ADD COLUMN "organization_id" UUID;

-- Create index for organization workspaces
CREATE INDEX "idx_workspaces_organization_id" ON "workspaces"("organization_id");

-- Add IP allowlist fields to workspaces
ALTER TABLE "workspaces" ADD COLUMN "ip_allowlist" TEXT[];
ALTER TABLE "workspaces" ADD COLUMN "ip_allowlist_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Add deployment protection fields to projects
ALTER TABLE "projects" ADD COLUMN "deployment_protection" JSONB DEFAULT '{"requireApproval": false, "allowedReviewers": []}';

-- Add notification preferences to users
ALTER TABLE "users" ADD COLUMN "notification_preferences" JSONB DEFAULT '{"email": true, "webhook": false, "slack": false}';

-- Add webhook URLs to workspaces
ALTER TABLE "workspaces" ADD COLUMN "webhook_urls" TEXT[];

-- Create audit log entries table for admin viewing
CREATE TABLE "audit_log_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "workspace_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "metadata" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- Create indexes for audit log queries
CREATE INDEX "idx_audit_log_entries_user_id" ON "audit_log_entries"("user_id");
CREATE INDEX "idx_audit_log_entries_workspace_id" ON "audit_log_entries"("workspace_id");
CREATE INDEX "idx_audit_log_entries_created_at" ON "audit_log_entries"("created_at");
CREATE INDEX "idx_audit_log_entries_action" ON "audit_log_entries"("action");

-- Add foreign key constraints
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_fkey" 
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" 
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_fkey" 
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_workspace_id_fkey" 
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
