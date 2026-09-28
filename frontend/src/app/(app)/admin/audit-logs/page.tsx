"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Shield,
  RefreshCw,
  Filter,
  Calendar,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { id: string; email: string; displayName: string } | null;
  workspace: { id: string; name: string } | null;
}

interface AuditLogResponse {
  entries: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

const ACTION_COLORS: Record<string, string> = {
  USER_LOGIN: "bg-success/15 text-success",
  USER_LOGOUT: "bg-surface-3 text-text-muted",
  WORKSPACE_CREATED: "bg-brand/15 text-brand",
  TASK_CREATED: "bg-info/15 text-info",
  TASK_COMPLETED: "bg-success/15 text-success",
  TASK_FAILED: "bg-danger/15 text-danger",
  DEPLOYMENT_STARTED: "bg-warning/15 text-warning",
  DEPLOYMENT_COMPLETED: "bg-success/15 text-success",
  DEPLOYMENT_FAILED: "bg-danger/15 text-danger",
  ADMIN_USER_UPDATED: "bg-danger/15 text-danger",
};

export default function AdminAuditLogPage() {
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const auditLogs = useQuery({
    queryKey: ["admin", "audit-logs", actionFilter, entityFilter, page],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: (page * limit).toString(),
      });
      if (actionFilter) params.set("action", actionFilter);
      if (entityFilter) params.set("entityType", entityFilter);
      return apiFetch<AuditLogResponse>(`/v1/admin/audit-logs?${params.toString()}`);
    },
  });

  const totalPages = auditLogs.data ? Math.ceil(auditLogs.data.total / limit) : 0;

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">Audit Logs</h1>
            <p className="mt-1 text-[12px] text-text-muted">
              Platform-wide audit trail for all actions
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(0);
              }}
              className="w-full pl-9 pr-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg appearance-none focus:outline-none focus:border-brand"
            >
              <option value="">All Actions</option>
              <option value="USER_LOGIN">User Login</option>
              <option value="WORKSPACE_CREATED">Workspace Created</option>
              <option value="TASK_CREATED">Task Created</option>
              <option value="TASK_COMPLETED">Task Completed</option>
              <option value="TASK_FAILED">Task Failed</option>
              <option value="DEPLOYMENT_STARTED">Deployment Started</option>
              <option value="DEPLOYMENT_COMPLETED">Deployment Completed</option>
              <option value="DEPLOYMENT_FAILED">Deployment Failed</option>
            </select>
          </div>

          <div className="relative flex-1 min-w-[200px]">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
            <select
              value={entityFilter}
              onChange={(e) => {
                setEntityFilter(e.target.value);
                setPage(0);
              }}
              className="w-full pl-9 pr-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg appearance-none focus:outline-none focus:border-brand"
            >
              <option value="">All Entities</option>
              <option value="USER">User</option>
              <option value="WORKSPACE">Workspace</option>
              <option value="PROJECT">Project</option>
              <option value="TASK">Task</option>
              <option value="DEPLOYMENT">Deployment</option>
            </select>
          </div>

          <Button
            onClick={() => auditLogs.refetch()}
            variant="secondary"
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <div className="mt-4">
          {auditLogs.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          )}

          {auditLogs.isError && (
            <ErrorState
              error="Failed to load audit logs"
              onRetry={() => auditLogs.refetch()}
            />
          )}

          {auditLogs.data && (
            <>
              <Card className="overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border bg-surface-2">
                      <th className="text-left px-4 py-2.5 text-text-muted font-medium">Action</th>
                      <th className="text-left px-4 py-2.5 text-text-muted font-medium">Entity</th>
                      <th className="text-left px-4 py-2.5 text-text-muted font-medium">User</th>
                      <th className="text-left px-4 py-2.5 text-text-muted font-medium">IP</th>
                      <th className="text-left px-4 py-2.5 text-text-muted font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.data.entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-surface-1">
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              ACTION_COLORS[entry.action] ?? "bg-surface-3 text-text-muted"
                            }`}
                          >
                            {entry.action}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-text-primary">{entry.entityType}</p>
                          {entry.entityId && (
                            <p className="text-text-muted text-[11px] font-mono">
                              {entry.entityId.slice(0, 8)}...
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {entry.user ? (
                            <div>
                              <p className="text-text-primary">{entry.user.displayName}</p>
                              <p className="text-text-muted text-[11px]">{entry.user.email}</p>
                            </div>
                          ) : (
                            <span className="text-text-muted">System</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-text-muted font-mono text-[11px]">
                          {entry.ipAddress ?? "-"}
                        </td>
                        <td className="px-4 py-3 text-text-muted">
                          {new Date(entry.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <div className="mt-4 flex items-center justify-between text-[12px] text-text-muted">
                <p>
                  Showing {auditLogs.data.entries.length} of {auditLogs.data.total} entries
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    variant="secondary"
                    className="px-3 py-1"
                  >
                    Previous
                  </Button>
                  <span>
                    Page {page + 1} of {totalPages || 1}
                  </span>
                  <Button
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    variant="secondary"
                    className="px-3 py-1"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
