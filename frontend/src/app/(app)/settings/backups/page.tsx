"use client";

import { Database } from "lucide-react";
import { WorkspaceBackupManager } from "@/components/workspace-backup-manager";
import { AppShell } from "@/components/app-shell";

export default function BackupSettingsPage() {
  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <Database className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">Workspace Backups</h1>
            <p className="mt-1 text-[12px] text-text-muted">
              Create and manage backups of your workspace configuration
            </p>
          </div>
        </div>
        <WorkspaceBackupManager />
      </div>
    </AppShell>
  );
}
