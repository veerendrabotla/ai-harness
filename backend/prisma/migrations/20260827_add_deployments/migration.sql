-- CreateEnum
CREATE TYPE "DeploymentEnv" AS ENUM ('production', 'preview', 'staging');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('QUEUED', 'PREPARING', 'BUILDING', 'DEPLOYING', 'HEALTH_CHECKING', 'READY', 'FAILED', 'CANCELLED', 'ROLLED_BACK');

-- CreateTable
CREATE TABLE "deployments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "task_id" UUID,
    "checkpoint_id" UUID,
    "created_by" UUID NOT NULL,
    "environment" "DeploymentEnv" NOT NULL DEFAULT 'production',
    "status" "DeploymentStatus" NOT NULL DEFAULT 'QUEUED',
    "build_command" VARCHAR(2048) NOT NULL DEFAULT 'npm run build',
    "output_dir" VARCHAR(512),
    "deployment_url" VARCHAR(2048),
    "preview_url" VARCHAR(2048),
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

-- CreateIndex
CREATE INDEX "deployments_project_id_created_at_idx" ON "deployments"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "deployments_status_idx" ON "deployments"("status");

-- CreateIndex
CREATE INDEX "deployments_task_id_idx" ON "deployments"("task_id");

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "checkpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_rollback_of_id_fkey" FOREIGN KEY ("rollback_of_id") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
