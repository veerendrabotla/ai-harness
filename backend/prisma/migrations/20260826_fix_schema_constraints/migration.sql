-- FixSchemaConstraints: Add FK for WorkspaceInvite.invitedBy, remove redundant indexes, add onDelete Cascade

-- 1. Remove redundant indexes
DROP INDEX IF EXISTS "task_events_task_id_sequence_number_idx";
DROP INDEX IF EXISTS "task_runs_task_id_idx";

-- 2. Add FK constraint for WorkspaceInvite.invitedBy -> User
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invited_by_fkey"
  FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Add index on invitedBy for query performance
CREATE INDEX IF NOT EXISTS "workspace_invites_invited_by_idx" ON "workspace_invites"("invited_by");

-- 4. Add unique constraint on (workspaceId, email) to prevent duplicate invites
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_email_key"
  UNIQUE ("workspace_id", "email");

-- 5. Add onDelete Cascade to Task.workspace and Task.project relations
-- Note: These require dropping and recreating the foreign keys
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_workspace_id_fkey";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_project_id_fkey";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
