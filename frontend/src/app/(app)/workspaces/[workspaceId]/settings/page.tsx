"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { policyUpdateRequestSchema } from "@ai-harness/contracts";
import { apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, RiskBadge } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { TaskTemplatesManager } from "@/components/task-templates-manager";

type PolicyValues = z.infer<typeof policyUpdateRequestSchema>;

export default function WorkspaceSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;

  const policy = useQuery({
    queryKey: ["policy", workspaceId],
    queryFn: () =>
      apiFetch<{
        requirePlanApproval: boolean;
        allowDirectExecution: boolean;
        blockOnReviewFindings: boolean;
        maxTaskDurationSeconds: number;
        maxToolCallsPerRun: number;
        toolRules: Array<{ id: string; toolName: string; riskLevel: string; decision: string; actionPattern: string | null }>;
      }>(`/v1/workspaces/${workspaceId}/policy`),
  });

  const instructions = useQuery({
    queryKey: ["instructions", workspaceId],
    queryFn: () =>
      apiFetch<Array<{ id: string; version: number; content: string; createdAt: string }>>(
        `/v1/workspaces/${workspaceId}/instructions`,
      ),
  });

  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (instructions.data?.[0]) setContent(instructions.data[0].content);
  }, [instructions.data]);

  const form = useForm<PolicyValues>({
    resolver: zodResolver(policyUpdateRequestSchema),
    values: policy.data
      ? {
          requirePlanApproval: policy.data.requirePlanApproval,
          allowDirectExecution: policy.data.allowDirectExecution,
          maxTaskDurationSeconds: policy.data.maxTaskDurationSeconds,
          maxToolCallsPerRun: policy.data.maxToolCallsPerRun,
          blockOnReviewFindings: policy.data.blockOnReviewFindings,
        }
      : undefined,
  });

  const savePolicy = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch(`/v1/workspaces/${workspaceId}/policy`, {
        method: "PUT",
        json: { ...values, toolRules: undefined },
      });
      await policy.refetch();
    } catch (err) {
      setError(err);
    }
  });

  async function saveInstructions() {
    setSaveState("saving");
    setError(null);
    try {
      await apiFetch(`/v1/workspaces/${workspaceId}/instructions`, {
        method: "POST",
        json: { content },
      });
      setSaveState("saved");
      await instructions.refetch();
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (err) {
      setSaveState("idle");
      setError(err);
    }
  }

  if (policy.isLoading || instructions.isLoading) return <AppShell><div className="px-6 py-5 pb-24 mx-auto max-w-5xl"><Skeleton className="h-64" /></div></AppShell>;
  if (policy.isError) return <AppShell><div className="px-6 py-5 pb-24 mx-auto max-w-5xl"><ErrorState error={policy.error} onRetry={() => void policy.refetch()} /></div></AppShell>;

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <h1 className="text-h1">Workspace settings</h1>
      <p className="mt-1 text-[12px] text-text-muted">Owner-only configuration. Every change is recorded in the audit log.</p>

      {error ? <div className="mt-4"><ErrorState error={error} /></div> : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Execution policy</CardTitle>
          </CardHeader>
          <form onSubmit={savePolicy} className="space-y-4">
            <SwitchField
              label="Require plan approval before execution"
              registration={form.register("requirePlanApproval")}
              defaultChecked={form.getValues("requirePlanApproval")}
            />
            <SwitchField
              label="Block completion when the reviewer reports blocking issues"
              registration={form.register("blockOnReviewFindings")}
              defaultChecked={form.getValues("blockOnReviewFindings")}
            />
            <SwitchField
              label="Allow direct execution without plan approval"
              registration={form.register("allowDirectExecution")}
              defaultChecked={form.getValues("allowDirectExecution")}
            />
            <Field label="Max task duration (seconds)" htmlFor="dur">
              <Input id="dur" type="number" {...form.register("maxTaskDurationSeconds", { valueAsNumber: true })} />
            </Field>
            <Field label="Max tool calls per run" htmlFor="mtc">
              <Input id="mtc" type="number" {...form.register("maxToolCallsPerRun", { valueAsNumber: true })} />
            </Field>
            <Button type="submit" loading={form.formState.isSubmitting}>Save policy</Button>
          </form>

          {policy.data && policy.data.toolRules.length > 0 ? (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Tool rules</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {policy.data.toolRules.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <code className="font-mono text-xs text-info">{r.toolName}</code>
                    <RiskBadge risk={r.riskLevel} />
                    <span className={
                      r.decision === "ALLOW" ? "text-success" : r.decision === "DENY" ? "text-danger" : "text-warning"
                    }>
                      → {r.decision.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instructions</CardTitle>
            <span className="text-xs text-text-muted">
              v{instructions.data?.[0]?.version ?? 0}
            </span>
          </CardHeader>
          <label htmlFor="instr" className="sr-only">Workspace instructions</label>
          <textarea
            id="instr"
            rows={14}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={"Project conventions the agent must follow…"}
            className="w-full rounded-lg border border-border bg-surface-1 p-3 font-mono text-xs text-text-primary focus:border-brand focus:outline-none"
          />
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={() => void saveInstructions()} loading={saveState === "saving"}>
              <Save className="h-4 w-4" aria-hidden /> Save new version
            </Button>
            {saveState === "saved" ? <span className="text-xs text-success">Saved as new version ✓</span> : null}
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Instructions are versioned — every save creates an immutable version used by future runs.
          </p>
        </Card>
      </div>

      <div className="mt-8">
        <TaskTemplatesManager workspaceId={workspaceId} />
      </div>
      </div>
    </AppShell>
  );
}

function SwitchField({
  label,
  registration,
  defaultChecked,
}: {
  label: string;
  registration: ReturnType<ReturnType<typeof useForm>["register"]>;
  defaultChecked?: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked ?? false);
  const { onChange, ...restRegistration } = registration;
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
      <span className="text-sm">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          setChecked(e.target.checked);
          void onChange(e);
        }}
        {...restRegistration}
        className="h-5 w-5 accent-[#5B8CFF]"
      />
    </label>
  );
}
