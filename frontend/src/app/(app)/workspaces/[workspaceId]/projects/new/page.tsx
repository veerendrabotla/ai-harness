"use client";

import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { z } from "zod";
import { createProjectRequestSchema } from "@ai-harness/contracts";
import { ApiError, apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";

type Values = z.infer<typeof createProjectRequestSchema>;

export default function NewProjectPage() {
  const router = useRouter();
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const [serverError, setServerError] = useState<ApiError | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(createProjectRequestSchema),
    defaultValues: { name: "", connectionType: "CLOUD", rootReference: "" },
  });
  const connectionType = watch("connectionType");

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await apiFetch(`/v1/workspaces/${workspaceId}/projects`, { method: "POST", json: values });
      router.push(`/workspaces/${workspaceId}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Failed to add project"));
    }
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <h1 className="text-h1">Add project</h1>
      <p className="mt-1 text-[12px] text-text-muted">
        Connect a repository to this workspace. Local Bridge roots require a connected bridge.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-8 max-w-xl space-y-5">
        {serverError ? <ErrorState error={serverError} /> : null}
        <Card className="space-y-5">
          <Field label="Name" htmlFor="name" required error={errors.name?.message}>
            <Input id="name" maxLength={160} placeholder="e.g. api-service" {...register("name")} />
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text-secondary">Connection type</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["CLOUD", "LOCAL_BRIDGE"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={connectionType === t}
                  onClick={() => setValue("connectionType", t)}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    connectionType === t
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border text-text-secondary hover:bg-surface-2"
                  }`}
                >
                  {t === "CLOUD" ? "Cloud / repository reference" : "Local Bridge root"}
                </button>
              ))}
            </div>
          </fieldset>

          <Field
            label={connectionType === "CLOUD" ? "Repository URL (optional)" : "Bridge ID"}
            htmlFor="repoOrBridge"
            error={errors.repositoryUrl?.message ?? errors.bridgeId?.message}
          >
            {connectionType === "CLOUD" ? (
              <Input id="repoOrBridge" placeholder="https://github.com/org/repo" {...register("repositoryUrl")} />
            ) : (
              <Input id="repoOrBridge" placeholder="Existing bridge UUID" {...register("bridgeId")} />
            )}
          </Field>

          <Field label="Root reference" htmlFor="rootReference" required error={errors.rootReference?.message}>
            <Input id="rootReference" placeholder="github.com/org/repo or registered local root path" {...register("rootReference")} />
          </Field>

          <Field label="Default branch (optional)" htmlFor="branch" error={errors.defaultBranch?.message}>
            <Input id="branch" placeholder="main" {...register("defaultBranch")} />
          </Field>
        </Card>

        <Button type="submit" loading={isSubmitting}>Add project</Button>
      </form>
      </div>
    </AppShell>
  );
}
