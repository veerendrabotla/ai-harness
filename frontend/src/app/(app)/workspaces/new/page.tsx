"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { z } from "zod";
import { createWorkspaceRequestSchema } from "@ai-harness/contracts";
import { ApiError, apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";

const formSchema = createWorkspaceRequestSchema;
type Values = z.infer<typeof formSchema>;

export default function NewWorkspacePage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<ApiError | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      executionMode: "CLOUD",
      description: undefined,
      initialInstructions: undefined,
    },
  });

  const mode = watch("executionMode");

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const created = await apiFetch<{ id: string }>("/v1/workspaces", {
        method: "POST",
        json: values,
      });
      router.push(`/workspaces/${created.id}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Failed to create workspace"));
    }
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <h1 className="text-h1">New workspace</h1>
      <p className="mt-1 text-[12px] text-text-muted">
        A default policy (plan approval required) is created automatically.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-8 max-w-xl space-y-5">
        {serverError ? <ErrorState error={serverError} /> : null}

        <Card className="space-y-5">
          <Field label="Name" htmlFor="name" required error={errors.name?.message}>
            <Input id="name" maxLength={120} placeholder="e.g. Acme Web App" {...register("name")} />
          </Field>

          <Field label="Description" htmlFor="description" error={errors.description?.message}>
            <Textarea id="description" rows={2} maxLength={2000} {...register("description")} />
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text-secondary">
              Execution mode <span className="text-danger">*</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["CLOUD", "LOCAL_CONNECTED", "HYBRID"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setValue("executionMode", m)}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    mode === m
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border text-text-secondary hover:bg-surface-2"
                  }`}
                >
                  {m === "CLOUD" ? "Cloud" : m === "LOCAL_CONNECTED" ? "Local Bridge" : "Hybrid"}
                </button>
              ))}
            </div>
          </fieldset>

          <Field label="Initial instructions (optional)" htmlFor="instructions" error={errors.initialInstructions?.message}>
            <Textarea
              id="instructions"
              rows={5}
              placeholder="Project conventions the agent must follow…"
              {...register("initialInstructions")}
            />
          </Field>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" loading={isSubmitting}>Create workspace</Button>
          <Button type="button" variant="ghost" asChild>
            <Link href="/workspaces">Cancel</Link>
          </Button>
        </div>
      </form>
      </div>
    </AppShell>
  );
}
