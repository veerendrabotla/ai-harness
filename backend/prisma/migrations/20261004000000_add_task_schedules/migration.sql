-- CreateEnum
CREATE TYPE "ScheduleCadence" AS ENUM ('EVERY_MINUTES', 'HOURLY', 'DAILY', 'WEEKLY');

-- CreateTable
CREATE TABLE "task_schedules" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "goal" TEXT NOT NULL,
    "constraints" TEXT,
    "cadence" "ScheduleCadence" NOT NULL,
    "interval_minutes" INTEGER,
    "minute_of_hour" INTEGER,
    "time_of_day" VARCHAR(5),
    "day_of_week" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ(6) NOT NULL,
    "last_run_at" TIMESTAMPTZ(6),
    "last_task_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_schedules_enabled_next_run_at_idx" ON "task_schedules"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "task_schedules_workspace_id_idx" ON "task_schedules"("workspace_id");

-- AddForeignKey
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_last_task_id_fkey" FOREIGN KEY ("last_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
