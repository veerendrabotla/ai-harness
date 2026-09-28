-- CreateTable
CREATE TABLE "workspace_backups" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_backups_workspace_id_created_at_idx" ON "workspace_backups"("workspace_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "workspace_backups" ADD CONSTRAINT "workspace_backups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
