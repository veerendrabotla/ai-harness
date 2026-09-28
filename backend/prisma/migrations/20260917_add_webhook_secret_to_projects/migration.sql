-- AlterTable
ALTER TABLE "projects" ADD COLUMN "webhook_secret" VARCHAR(255);

-- CreateIndex
CREATE INDEX "projects_workspace_id_status_idx" ON "projects"("workspace_id", "status");
