"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { passwordSchema } from "@ai-harness/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError, apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, SecretInput } from "@/components/ui/form";
import { EmptyState, ErrorState } from "@/components/ui/states";

const schema = z.object({
  token: z.string().min(10),
  newPassword: passwordSchema,
});
type Values = z.infer<typeof schema>;

function ResetForm() {
  const params = useSearchParams();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { token: params.get("token") ?? "", newPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch("/v1/auth/reset-password", {
        method: "POST",
        json: values,
        skipAuth: true,
        retryOn401: false,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Reset failed"));
    }
  });

  if (done) {
    return (
      <>
        <EmptyState
          what="Password updated"
          why="All existing sessions were signed out. Sign in with your new password."
        />
        <Link href="/login" className="mt-6 inline-block text-sm text-brand hover:text-brand-hover">
          Go to sign in
        </Link>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
      {error ? <ErrorState error={error} /> : null}
      <Field label="Reset token" htmlFor="token" required error={errors.token?.message}>
        <input
          id="token"
          className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2 font-mono text-xs text-text-primary"
          {...register("token")}
        />
      </Field>
      <Field label="New password" htmlFor="newPassword" required error={errors.newPassword?.message}>
        <SecretInput id="newPassword" autoComplete="new-password" {...register("newPassword")} />
      </Field>
      <Button type="submit" loading={isSubmitting} className="w-full">
        Set new password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center px-4 py-16">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-h1">Choose a new password</h1>
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}
