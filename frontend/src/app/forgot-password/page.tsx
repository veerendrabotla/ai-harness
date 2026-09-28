"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError, apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ErrorState, EmptyState } from "@/components/ui/states";

const schema = z.object({ email: z.string().email("Enter a valid email") });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      // Always succeeds outward; token delivery arrives with the email phase.
      await apiFetch("/v1/auth/forgot-password", {
        method: "POST",
        json: values,
        skipAuth: true,
        retryOn401: false,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Request failed"));
    }
  });

  return (
    <main className="flex min-h-dvh items-center px-4 py-16">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-h1">Reset your password</h1>
        {sent ? (
          <div className="mt-8">
            <EmptyState
              what="Check your inbox"
              why="If an account exists for that address, a reset link has been generated. The link expires in 30 minutes."
            />
            <Link href="/login" className="mt-6 inline-block text-sm text-brand hover:text-brand-hover">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-text-muted">
              Enter the email associated with your account.
            </p>
            <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
              {error ? <ErrorState error={error} /> : null}
              <Field label="Email" htmlFor="email" required error={errors.email?.message}>
                <Input id="email" type="email" autoComplete="email" {...register("email")} />
              </Field>
              <Button type="submit" loading={isSubmitting} className="w-full">
                Send reset link
              </Button>
            </form>
            <Link href="/login" className="mt-6 inline-block text-sm text-text-secondary hover:text-brand">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
