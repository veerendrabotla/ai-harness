"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Plus, Trash2, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { ScheduleDtoLike, WorkspaceDtoLike, ProjectDtoLike } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cadenceLabel(s: Pick<ScheduleDtoLike, "cadence" | "intervalMinutes" | "minuteOfHour" | "timeOfDay" | "dayOfWeek">): string {
  switch (s.cadence) {
    case "EVERY_MINUTES":
      return `Every ${s.intervalMinutes} min`;
    case "HOURLY":
      return `Hourly at :${String(s.minuteOfHour ?? 0).padStart(2, "0")}`;
    case "DAILY":
      return `Daily ${s.timeOfDay} UTC`;
    case "WEEKLY":
      return `${DAY_NAMES[s.dayOfWeek ?? 0]} ${s.timeOfDay} UTC`;
    default:
      return s.cadence;
  }
}

interface CreateForm {
  workspaceId: string;
  projectId: string;
  name: string;
  goal: string;
  cadence: ScheduleDtoLike["cadence"];
  intervalMinutes: number;
  minuteOfHour: number;
  timeOfDay: string;
  dayOfWeek: number;
}

const EMPTY_FORM: CreateForm = {
  workspaceId: "",
  projectId: "",
  name: "",
  goal: "",
  cadence: "EVERY_MINUTES",
  intervalMinutes: 5,
  minuteOfHour: 0,
  timeOfDay: "09:00",
  dayOfWeek: 1,
};

function buildCadenceBody(f: CreateForm): Record<string, unknown> {
  switch (f.cadence) {
    case "EVERY_MINUTES":
      return { cadence: "EVERY_MINUTES", intervalMinutes: f.intervalMinutes };
    case "HOURLY":
      return { cadence: "HOURLY", minuteOfHour: f.minuteOfHour };
    case "DAILY":
      return { cadence: "DAILY", timeOfDay: f.timeOfDay };
    case "WEEKLY":
      return { cadence: "WEEKLY", timeOfDay: f.timeOfDay, dayOfWeek: f.dayOfWeek };
  }
}

export default function SchedulesPage() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["schedules"],
    queryFn: () => apiFetch<ScheduleDtoLike[]>("/v1/schedules"),
    refetchInterval: 5000,
  });

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<WorkspaceDtoLike[]>("/v1/workspaces"),
    enabled: showForm,
  });

  const projectsQuery = useQuery({
    queryKey: ["projects", form.workspaceId],
    enabled: showForm && Boolean(form.workspaceId),
    queryFn: () => apiFetch<ProjectDtoLike[]>(`/v1/workspaces/${form.workspaceId}/projects`),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const body = {
        workspaceId: form.workspaceId,
        projectId: form.projectId,
        name: form.name,
        goal: form.goal,
        enabled: true,
        ...buildCadenceBody(form),
      };
      return apiFetch<ScheduleDtoLike>("/v1/schedules", { method: "POST", json: body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["schedules"] });
      setForm(EMPTY_FORM);
      setShowForm(false);
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (s: ScheduleDtoLike) =>
      apiFetch<ScheduleDtoLike>(`/v1/schedules/${s.id}`, { method: "PATCH", json: { enabled: !s.enabled } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (s: ScheduleDtoLike) => apiFetch(`/v1/schedules/${s.id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.workspaceId || !form.projectId) {
      setFormError("Pick a workspace and project.");
      return;
    }
    if (!form.name.trim() || form.goal.trim().length < 4) {
      setFormError("Name and goal are required (goal: at least 4 characters).");
      return;
    }
    createMutation.mutate();
  };

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-h1">Schedules</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Recurring tasks fired automatically on UTC cadences — plans, approvals, and notifications work exactly
              like manually created tasks.
            </p>
          </div>
          <Button onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            New schedule
          </Button>
        </div>

        {showForm && (
          <Card className="mt-5">
            <CardTitle>New schedule</CardTitle>
            <form onSubmit={submit} className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  Workspace
                  <select
                    required
                    value={form.workspaceId}
                    onChange={(e) => setForm({ ...form, workspaceId: e.target.value, projectId: "" })}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-2 text-sm"
                  >
                    <option value="">Select workspace…</option>
                    {(workspacesQuery.data ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Project
                  <select
                    required
                    disabled={!form.workspaceId}
                    value={form.projectId}
                    onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-2 text-sm disabled:opacity-50"
                  >
                    <option value="">Select project…</option>
                    {(projectsQuery.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-sm">
                Name
                <input
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Nightly build"
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
                />
              </label>

              <label className="block text-sm">
                Goal
                <textarea
                  required
                  minLength={4}
                  rows={3}
                  value={form.goal}
                  onChange={(e) => setForm({ ...form, goal: e.target.value })}
                  placeholder="What should the agent do on every run?"
                  className="mt-1 w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm">
                  Cadence
                  <select
                    value={form.cadence}
                    onChange={(e) => setForm({ ...form, cadence: e.target.value as CreateForm["cadence"] })}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-2 text-sm"
                  >
                    <option value="EVERY_MINUTES">Every N minutes</option>
                    <option value="HOURLY">Hourly</option>
                    <option value="DAILY">Daily (UTC)</option>
                    <option value="WEEKLY">Weekly (UTC)</option>
                  </select>
                </label>

                {form.cadence === "EVERY_MINUTES" && (
                  <label className="block text-sm">
                    Interval (minutes)
                    <input
                      type="number"
                      min={1}
                      max={10080}
                      required
                      value={form.intervalMinutes}
                      onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
                    />
                  </label>
                )}

                {form.cadence === "HOURLY" && (
                  <label className="block text-sm">
                    Minute of hour
                    <input
                      type="number"
                      min={0}
                      max={59}
                      required
                      value={form.minuteOfHour}
                      onChange={(e) => setForm({ ...form, minuteOfHour: Number(e.target.value) })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
                    />
                  </label>
                )}

                {(form.cadence === "DAILY" || form.cadence === "WEEKLY") && (
                  <label className="block text-sm">
                    Time (UTC)
                    <input
                      type="time"
                      required
                      value={form.timeOfDay}
                      onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
                    />
                  </label>
                )}

                {form.cadence === "WEEKLY" && (
                  <label className="block text-sm">
                    Day of week
                    <select
                      value={form.dayOfWeek}
                      onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-2 text-sm"
                    >
                      {DAY_NAMES.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {formError && (
                <p role="alert" className="text-sm text-danger">
                  {formError}
                </p>
              )}

              <div className="flex items-center gap-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
                  Create schedule
                </Button>
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}

        <div className="mt-6">
          {query.isLoading ? (
            <div className="space-y-2">
              <Skeleton />
              <Skeleton />
            </div>
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (query.data ?? []).length === 0 ? (
            <EmptyState
              what="No schedules yet"
              why="Create a schedule to run a task on a recurring cadence — nightly builds, hourly health checks, weekly reports."
            />
          ) : (
            <ul className="space-y-2">
              {query.data!.map((s) => (
                <li
                  key={s.id}
                  className="rounded-xl border border-border bg-surface-1 px-4 py-3.5"
                  data-enabled={s.enabled}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {s.name}
                        <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
                          {cadenceLabel(s)}
                        </span>
                        {!s.enabled && (
                          <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
                            paused
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-text-muted">{s.goal}</p>
                      <p className="mt-1 text-xs text-text-muted">
                        Next run: {new Date(s.nextRunAt).toLocaleString(undefined, { timeZone: "UTC" })} UTC
                        {s.lastTaskId && (
                          <>
                            {" · "}
                            <Link href={`/tasks/${s.lastTaskId}`} className="underline hover:text-text-secondary">
                              Last run
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => toggleMutation.mutate(s)}
                        disabled={toggleMutation.isPending}
                        aria-label={s.enabled ? `Pause ${s.name}` : `Resume ${s.name}`}
                      >
                        {s.enabled ? "Pause" : "Resume"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete schedule "${s.name}"?`)) deleteMutation.mutate(s);
                        }}
                        className="rounded-lg border border-border p-2 text-text-muted hover:border-border-strong"
                        aria-label={`Delete ${s.name}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
