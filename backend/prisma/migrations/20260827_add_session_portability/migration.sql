-- AlterTable: Add parentTaskId to Task
ALTER TABLE "tasks" ADD COLUMN "parent_task_id" UUID;

-- CreateTable: SessionExport
CREATE TABLE "session_exports" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "exported_by" UUID NOT NULL,
    "exported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "package_json" JSONB NOT NULL,

    CONSTRAINT "session_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SessionShare
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

-- CreateIndex
CREATE UNIQUE INDEX "session_shares_token_hash_key" ON "session_shares"("token_hash");

-- CreateIndex
CREATE INDEX "session_exports_task_id_idx" ON "session_exports"("task_id");

-- CreateIndex
CREATE INDEX "session_shares_task_id_idx" ON "session_shares"("task_id");

-- CreateIndex
CREATE INDEX "session_shares_token_hash_idx" ON "session_shares"("token_hash");

-- CreateIndex
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks"("parent_task_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_exports" ADD CONSTRAINT "session_exports_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_exports" ADD CONSTRAINT "session_exports_exported_by_fkey" FOREIGN KEY ("exported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_shares" ADD CONSTRAINT "session_shares_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_shares" ADD CONSTRAINT "session_shares_shared_by_fkey" FOREIGN KEY ("shared_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
