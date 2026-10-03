"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Pause, Play, RotateCcw, ShieldAlert, Square, X, Copy, GitFork } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { VirtualList } from "@/components/virtual-list.js";
import type {
  EventLike,
  PlanLike,
  TaskDtoLike,
} from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, RiskBadge, StateBadge } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Textarea } from "@/components/ui/form";
import { TaskBranches } from "@/components/task-branches";

interface ApprovalLike {
  id: string;
  status: string;
  requestedScope: string;
  expiresAt: string;
  toolCall?: {
    id: string;
    toolName: string;
    riskLevel: string;
    inputSummary: unknown;
  };
}

const TABS = ["activity", "plan", "approvals", "verification", "context", "changes", "branches"] as const;
type Tab = (typeof TABS)[number];

export default function TaskDetailPage() {
  const params = useParams<{ taskId: string }>();
  const router = useRouter();
  const taskId = params.taskId;
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("activity");
  const [revision, setRevision] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  // Realtime: socket events + polling fallback both invalidate this task's queries.

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => apiFetch<TaskDtoLike & { viewerRole: string }>(`/v1/tasks/${taskId}`),
    refetchInterval: (q) => {
      const state = q.state.data?.state;
      const active = state && !["COMPLETED", "FAILED", "CANCELLED"].includes(state);
      return active ? 4000 : false;
    },
  });

  const eventsQuery = useQuery({
    queryKey: ["events", taskId],
    queryFn: async () => {
      const last = lastSequence(qc, taskId);
      const suffix = last >= 0 ? `?afterSequence=${last}&limit=500` : "?limit=200";
      return apiFetch<EventLike[]>(`/v1/tasks/${taskId}/events${suffix}`);
    },
    refetchInterval: 4000,
  });

  const plansQuery = useQuery({
    queryKey: ["plans", taskId],
    queryFn: () => apiFetch<PlanLike[]>(`/v1/tasks/${taskId}/plans`),
  });

  const approvalsQuery = useQuery({
    queryKey: ["approvals", taskId],
    queryFn: () => apiFetch<ApprovalLike[]>(`/v1/tasks/${taskId}/approvals`),
    refetchInterval: 4000,
  });

  const verificationQuery = useQuery({
    queryKey: ["verification", taskId],
    queryFn: () =>
      apiFetch<Array<{ id: string; command: string; status: string; outputReference: string | null }>>(
        `/v1/tasks/${taskId}/verification`,
      ),
  });

  const contextQuery = useQuery({
    queryKey: ["context", taskId],
    queryFn: () =>
      apiFetch<Array<{ id: string; stage: string; estimatedTokens: number; manifest: { items: Array<{ identifier: string; sourceType: string; inclusionReason: string }>; omitted: unknown[]; usedBytes: number; budgetBytes: number } }>>(
        `/v1/tasks/${taskId}/context`,
      ),
  });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["events", taskId] });
    void qc.invalidateQueries({ queryKey: ["task", taskId] });
    void qc.invalidateQueries({ queryKey: ["plans", taskId] });
    void qc.invalidateQueries({ queryKey: ["approvals", taskId] });
    void qc.invalidateQueries({ queryKey: ["verification", taskId] });
    void qc.invalidateQueries({ queryKey: ["context", taskId] });
  };

  async function act(path: string, json?: unknown) {
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/v1/tasks/${taskId}${path}`, { method: "POST", json: json ?? {} });
      invalidateAll();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function decideApproval(approvalId: string, approved: boolean) {
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/v1/approvals/${approvalId}/${approved ? "approve" : "deny"}`, {
        method: "POST",
        json: {},
      });
      invalidateAll();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  const task = taskQuery.data;
  const latestPlan = (plansQuery.data ?? [])[0];
  const pendingApprovals = (approvalsQuery.data ?? []).filter((a) => a.status === "PENDING");

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      {task ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-h1">Task</h1>
              <p className="mt-1 max-w-2xl text-sm text-text-secondary">{task.goal}</p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <StateBadge state={task.state} />
              <div className="flex flex-wrap justify-end gap-2">
                {!["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(task.state) ? (
                  <>
                    {["WAITING_FOR_APPROVAL", "WAITING_FOR_TOOL_APPROVAL", "QUEUED"].includes(task.state) ? (
                      <Button variant="danger" loading={busy} onClick={() => void act("/cancel")}>
                        <Square className="h-3.5 w-3.5" aria-hidden /> Cancel
                      </Button>
                    ) : (
                      <Button variant="secondary" loading={busy} onClick={() => void act("/pause")}>
                        <Pause className="h-3.5 w-3.5" aria-hidden /> Pause
                      </Button>
                    )}
                  </>
                ) : null}
                {task.state === "INTERRUPTED" ? (
                  <Button loading={busy} onClick={() => void act("/resume")}>
                    <Play className="h-3.5 w-3.5" aria-hidden /> Resume
                  </Button>
                ) : null}
                {["COMPLETED", "FAILED", "CANCELLED"].includes(task.state) ? (
                  <Button variant="outline" loading={busy} onClick={() => { if (window.confirm("Retry this task?")) void act("/retry"); }}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
                  </Button>
                ) : null}
                {["COMPLETED", "FAILED", "CANCELLED"].includes(task.state) ? (
                  <Button
                    variant="outline"
                    loading={busy}
                    onClick={async () => {
                      if (!window.confirm("Clone this task?")) return;
                      setBusy(true);
                      try {
                        const result = await apiFetch<{ taskId: string }>(`/v1/tasks/${taskId}/clone`, { method: "POST", json: {} });
                        router.push(`/tasks/${result.taskId}`);
                      } catch (err) {
                        setActionError(err);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden /> Clone
                  </Button>
                ) : null}
                {["COMPLETED", "FAILED", "CANCELLED"].includes(task.state) ? (
                  <Button
                    variant="outline"
                    loading={busy}
                    onClick={async () => {
                      if (!window.confirm("Fork this task?")) return;
                      setBusy(true);
                      try {
                        const result = await apiFetch<{ taskId: string }>(`/v1/tasks/${taskId}/fork`, { method: "POST", json: {} });
                        router.push(`/tasks/${result.taskId}`);
                      } catch (err) {
                        setActionError(err);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <GitFork className="h-3.5 w-3.5" aria-hidden /> Fork
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Usage Summary */}
          {task.inputTokens !== undefined && task.totalTokens !== undefined && task.totalTokens > 0 && (
            <div className="mt-4 flex items-center gap-4 text-sm text-text-muted">
              <span className="flex items-center gap-1.5">
                <span className="font-medium text-text-secondary">{task.totalTokens.toLocaleString()}</span> tokens
              </span>
              <span className="flex items-center gap-1.5">
                <span className="font-medium text-text-secondary">${(task.estimatedCost ?? 0).toFixed(2)}</span> cost
              </span>
            </div>
          )}

          {actionError ? (
            <div className="mt-4">
              <ErrorState error={actionError} />
            </div>
          ) : null}

          {/* Tabs */}
          <div role="tablist" aria-label="Task sections" className="mt-6 flex gap-1 overflow-x-auto border-b border-border pb-px">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-t-lg px-4 py-2 text-sm capitalize ${
                  tab === t
                    ? "border-x border-t border-border bg-surface-1 font-medium text-text-primary"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {t}
                {t === "approvals" && pendingApprovals.length > 0 ? (
                  <span className="ml-2 rounded-full bg-warning px-1.5 py-0.5 text-[11px] font-semibold text-[#0B1020]">
                    {pendingApprovals.length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-6">
            {tab === "activity" ? <ActivityTab events={eventsQuery.data ?? []} error={eventsQuery.error} retry={() => void eventsQuery.refetch()} /> : null}

            {tab === "plan" ? (
              <section className="space-y-4">
                {(plansQuery.data ?? []).length === 0 ? (
                  <EmptyState what="No plan yet" why="The agent publishes a structured plan here for your review before execution." />
                ) : null}
                {(plansQuery.data ?? []).map((plan) => (
                  <Card key={plan.id}>
                    <CardHeader>
                      <CardTitle>
                        Plan v{plan.version}{" "}
                        <span className={`ml-2 text-xs ${plan.status === "APPROVED" ? "text-success" : plan.status === "DRAFT" ? "text-warning" : "text-text-muted"}`}>
                          {plan.status.toLowerCase()}
                        </span>
                      </CardTitle>
                      {plan.status === "DRAFT" && task.state === "WAITING_FOR_APPROVAL" ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            loading={busy}
                            onClick={async () => {
                              try {
                                await apiFetch(`/v1/tasks/${taskId}/plans/${plan.id}/approve`, { method: "POST", json: {} });
                                invalidateAll();
                              } catch (err) {
                                setActionError(err instanceof Error ? err.message : "Failed to approve plan");
                              }
                            }}
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden /> Approve & run
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={busy}
                            onClick={async () => {
                              try {
                                await apiFetch(`/v1/tasks/${taskId}/plans/${plan.id}/reject`, { method: "POST", json: {} });
                                invalidateAll();
                              } catch (err) {
                                setActionError(err instanceof Error ? err.message : "Failed to reject plan");
                              }
                            }}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden /> Reject
                          </Button>
                        </div>
                      ) : null}
                    </CardHeader>

                    <p className="text-sm text-text-secondary">{plan.analysis}</p>

                    {plan.steps.length > 0 ? (
                      <ol className="mt-4 space-y-2">
                        {plan.steps.map((s, i) => (
                          <li key={s.id} className="rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm">
                            <span className="mr-2 font-mono text-xs text-text-muted">{i + 1}.</span>
                            {s.title}
                            {s.toolName ? (
                              <span className="ml-2 inline-flex items-center gap-1">
                                <RiskBadge risk={s.toolName.startsWith("filesystem.delete") || s.toolName === "terminal.run" ? "DESTRUCTIVE" : "WRITE"} />
                                <code className="font-mono text-xs text-info">{s.toolName}</code>
                              </span>
                            ) : null}
                            {(s.acceptanceCriteria?.length ?? 0) > 0 ? (
                              <ul className="mt-1 list-disc pl-5 text-xs text-text-muted">
                                {s.acceptanceCriteria!.map((c) => (
                                  <li key={c}>{c}</li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    {plan.risks.length > 0 ? (
                      <div className="mt-4">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Risks</h4>
                        <ul className="mt-1 list-disc pl-5 text-sm text-text-secondary">
                          {plan.risks.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {plan.status === "DRAFT" && task.state === "WAITING_FOR_APPROVAL" ? (
                      <div className="mt-4 border-t border-border pt-4">
                        <label htmlFor="revise" className="text-sm font-medium text-text-secondary">
                          Request revision
                        </label>
                        <Textarea id="revise" rows={2} value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="What should change in the plan?" className="mt-2" />
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mt-2"
                          disabled={revision.trim().length < 2 || busy}
                          onClick={async () => {
                            setBusy(true);
                            setActionError(null);
                            try {
                              await apiFetch(`/v1/tasks/${taskId}/plans/${plan.id}/revise`, {
                                method: "POST",
                                json: { instruction: revision },
                              });
                              setRevision("");
                              invalidateAll();
                            } catch (err) {
                              setActionError(err instanceof Error ? err.message : "Failed to request revision");
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Send revision request
                        </Button>
                      </div>
                    ) : null}
                  </Card>
                ))}
                {latestPlan?.status === "SUPERSEDED" ? (
                  <p className="text-xs text-text-muted">Older plan versions remain immutable above in history order.</p>
                ) : null}
              </section>
            ) : null}

            {tab === "approvals" ? (
              <section className="space-y-3">
                {(approvalsQuery.data ?? []).length === 0 ? (
                  <EmptyState
                    what="No approval requests"
                    why="When the agent needs permission for a risky action, it appears here and execution waits."
                  />
                ) : null}
                {(approvalsQuery.data ?? []).map((a) => (
                  <Card key={a.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 font-medium">
                          <ShieldAlert className="h-4 w-4 text-warning" aria-hidden />
                          {a.toolCall?.toolName ?? "Tool action"}
                        </p>
                        <p className="mt-1 text-[12px] text-text-muted">
                          Scope: {a.requestedScope.toLowerCase()} · status:{" "}
                          <span className={
                            a.status === "PENDING" ? "text-warning" :
                            a.status === "APPROVED" ? "text-success" :
                            a.status === "DENIED" ? "text-danger" : "text-text-muted"
                          }>
                            {a.status.toLowerCase()}
                          </span>
                          {a.status === "PENDING" ? ` · expires ${new Date(a.expiresAt).toLocaleTimeString()}` : ""}
                        </p>
                        {a.toolCall ? (
                          <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 font-mono text-xs text-text-secondary">
{JSON.stringify(a.toolCall.inputSummary, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                      {a.status === "PENDING" ? (
                        <div className="flex gap-2">
                          <Button size="sm" loading={busy} onClick={() => void decideApproval(a.id, true)}>
                            Approve once
                          </Button>
                          <Button size="sm" variant="danger" loading={busy} onClick={() => void decideApproval(a.id, false)}>
                            Deny
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </Card>
                ))}
              </section>
            ) : null}

            {tab === "verification" ? (
              <section className="space-y-3">
                {(verificationQuery.data ?? []).length === 0 ? (
                  <EmptyState what="No verification results yet" why="Verification runs after implementation steps complete." />
                ) : null}
                {(verificationQuery.data ?? []).map((v) => (
                  <Card key={v.id} className="flex items-center justify-between">
                    <code className="font-mono text-sm">{v.command}</code>
                    <span
                      className={
                        v.status === "PASSED" ? "text-success" :
                        v.status === "FAILED" ? "text-danger" :
                        "text-text-muted"
                      }
                    >
                      {v.status}
                      {v.outputReference ? ` · ${v.outputReference}` : ""}
                    </span>
                  </Card>
                ))}
              </section>
            ) : null}

            {tab === "context" ? (
              <section className="space-y-3">
                {(contextQuery.data ?? []).length === 0 ? (
                  <EmptyState what="No context packages yet" why="The exact context assembled for each model call is recorded here." />
                ) : null}
                {(contextQuery.data ?? []).map((pkg) => (
                  <Card key={pkg.id}>
                    <CardHeader>
                      <CardTitle>{pkg.stage.toLowerCase()} · ~{pkg.estimatedTokens} tokens</CardTitle>
                      <span className="text-xs text-text-muted">
                        {pkg.manifest.usedBytes}/{pkg.manifest.budgetBytes} bytes
                      </span>
                    </CardHeader>
                    <ul className="space-y-1 text-sm">
                      {pkg.manifest.items.map((item, i) => (
                        <li key={`${item.identifier}-${i}`} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5">
                          <span>
                            <code className="font-mono text-xs text-info">{item.sourceType}</code>{" "}
                            <span className="text-text-secondary">{item.identifier}</span>
                          </span>
                          <span className="max-w-[40%] truncate text-xs text-text-muted" title={item.inclusionReason}>
                            {item.inclusionReason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ))}
              </section>
            ) : null}

            {tab === "changes" ? (
              <EmptyState
                what="No file changes"
                why="Changes produced during execution appear here once write tools are enabled through the Local Bridge or Cloud Sandbox."
              />
            ) : null}

            {tab === "branches" ? <TaskBranches taskId={taskId} /> : null}
          </div>

        </>
      ) : taskQuery.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <ErrorState error={taskQuery.error} onRetry={() => void taskQuery.refetch()} />
      )}
      </div>
    </AppShell>
  );
}

function ActivityTab({
  events,
  error,
  retry,
}: {
  events: EventLike[];
  error: unknown;
  retry: () => void;
}) {
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (events.length === 0) return <EmptyState what="No activity yet" why="Runtime events stream here in chronological order." />;

  const reversed = [...events].reverse();

  if (reversed.length > 50) {
    return (
      <VirtualList
        items={reversed}
        ariaLabel="Activity stream"
        className="max-h-[600px]"
        estimateHeight={80}
        renderItem={(e, i) => (
          <li key={e.id} className="relative flex gap-4 pb-6">
            <div aria-hidden className="flex flex-col items-center">
              <span className="h-2.5 w-2.5 rounded-full bg-brand ring-4 ring-brand/15" />
              {i > 0 ? <span className="absolute top-2 h-full w-px bg-border" /> : null}
            </div>
            <div className="min-w-0 flex-1 -translate-y-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-mono text-xs font-semibold uppercase tracking-wide text-text-primary">
                  {e.eventType}
                </span>
                <span className="text-xs text-text-muted">{new Date(e.createdAt).toLocaleTimeString()}</span>
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] uppercase text-text-muted">
                  {e.actorType.toLowerCase()}
                </span>
              </div>
              {e.payload && Object.keys(e.payload).length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer select-none text-xs text-text-muted hover:text-text-secondary">
                    Details
                  </summary>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 font-mono text-xs text-text-secondary">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          </li>
        )}
      />
    );
  }

  return (
    <ol aria-label="Activity stream" className="space-y-0">
      {reversed.map((e, i) => (
        <li key={e.id} className="relative flex gap-4 pb-6">
          <div aria-hidden className="flex flex-col items-center">
            <span className="h-2.5 w-2.5 rounded-full bg-brand ring-4 ring-brand/15" />
            {i > 0 ? <span className="absolute top-2 h-full w-px bg-border" /> : null}
          </div>
          <div className="min-w-0 flex-1 -translate-y-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-mono text-xs font-semibold uppercase tracking-wide text-text-primary">
                {e.eventType}
              </span>
              <span className="text-xs text-text-muted">{new Date(e.createdAt).toLocaleTimeString()}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] uppercase text-text-muted">
                {e.actorType.toLowerCase()}
              </span>
            </div>
            {e.payload && Object.keys(e.payload).length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer select-none text-xs text-text-muted hover:text-text-secondary">
                  Details
                </summary>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 font-mono text-xs text-text-secondary">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function lastSequence(qc: QueryClient, taskId: string): number {
  const data = qc.getQueryData<EventLike[]>(["events", taskId]);
  if (!data || data.length === 0) return -1;
  return Math.max(...data.map((e) => e.sequenceNumber));
}


