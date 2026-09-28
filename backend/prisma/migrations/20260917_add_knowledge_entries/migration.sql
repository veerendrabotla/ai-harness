-- CreateEnum
CREATE TYPE "KnowledgeEntryType" AS ENUM ('DOCUMENT', 'CODE_SNIPPET', 'LINK', 'NOTE');

-- CreateTable
CREATE TABLE "knowledge_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "type" "KnowledgeEntryType" NOT NULL DEFAULT 'NOTE',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_entries_workspace_id_type_idx" ON "knowledge_entries"("workspace_id", "type");

-- CreateIndex
CREATE INDEX "knowledge_entries_workspace_id_created_at_idx" ON "knowledge_entries"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
