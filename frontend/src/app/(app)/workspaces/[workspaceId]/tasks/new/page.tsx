"use client";

import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { z } from "zod";
import { createTaskRequestSchema } from "@ai-harness/contracts";
import { ApiError, apiFetch } from "@/lib/api-client";
import type { ProjectDtoLike, ProviderLike } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";

const formSchema = createTaskRequestSchema;
type Values = z.infer<typeof formSchema>;

export default function NewTaskPage() {
  const router = useRouter();
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const [serverError, setServerError] = useState<ApiError | null>(null);

  const projects = useQuery({
    queryKey: ["projects", workspaceId],
    queryFn: () => apiFetch<ProjectDtoLike[]>(`/v1/workspaces/${workspaceId}/projects`),
  });
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => apiFetch<ProviderLike[]>("/v1/providers"),
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      workspaceId,
      projectId: "",
      goal: "",
      selectedModelMode: "ROUTED",
    },
  });

  const mode = watch("selectedModelMode");

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const created = await apiFetch<{ id: string }>("/v1/tasks", { method: "POST", json: values });
      router.push(`/tasks/${created.id}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Failed to create task"));
    }
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <h1 className="text-h1">New task</h1>
      <p className="mt-1 text-[12px] text-text-muted">
        The agent will gather context and draft a plan for your approval before touching anything.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-8 max-w-xl space-y-5">
        {serverError ? <ErrorState error={serverError} /> : null}

        <Card className="space-y-5">
          <Field label="Project" htmlFor="projectId" required error={errors.projectId?.message}>
            {projects.isLoading ? (
              <Input id="projectId" disabled placeholder="Loading…" />
            ) : (
              <select
                id="projectId"
                {...register("projectId")}
                className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
              >
                <option value="">Select a project…</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.status})
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Goal" htmlFor="goal" required error={errors.goal?.message}>
            <Textarea
              id="goal"
              rows={4}
              placeholder="Describe the outcome you want. Be specific about scope."
              {...register("goal")}
            />
          </Field>

          <Field label="Constraints (optional)" htmlFor="constraints" error={errors.constraints?.message}>
            <Textarea
              id="constraints"
              rows={2}
              placeholder="e.g. Only touch src/auth; keep dependencies unchanged."
              {...register("constraints")}
            />
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text-secondary">Model selection</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["ROUTED", "MANUAL"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setValue("selectedModelMode", m)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${
                    mode === m
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border text-text-secondary hover:bg-surface-2"
                  }`}
                >
                  {m === "ROUTED" ? "Automatic (workspace routing)" : "Manual override"}
                </button>
              ))}
            </div>
          </fieldset>

          {mode === "MANUAL" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Provider connection" htmlFor="conn" required error={errors.modelOverride?.providerConnectionId?.message}>
                <select
                  id="conn"
                  {...register("modelOverride.providerConnectionId")}
                  className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
                >
                  <option value="">Select…</option>
                  {(providers.data ?? [])
                    .filter((p) => p.status === "ACTIVE")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName} ({p.providerType})
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Model identifier" htmlFor="modelId" required error={errors.modelOverride?.modelIdentifier?.message}>
                <Input id="modelId" placeholder="e.g. claude-sonnet-4-5" {...register("modelOverride.modelIdentifier")} />
              </Field>
            </div>
          ) : null}
        </Card>

        <Button type="submit" loading={isSubmitting}>Create task</Button>
      </form>
      </div>
    </AppShell>
  );
}
