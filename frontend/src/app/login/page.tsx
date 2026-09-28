"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginRequestSchema, type LoginRequest } from "@ai-harness/contracts";
import { ApiError, apiFetch, apiUrl as apiBase } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { analytics } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";

import { GithubIcon, GoogleIcon } from "@/components/social-icons";

function SocialLoginButtons() {

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-surface px-2 text-text-muted">Or continue with</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <a
          href={`${apiBase}/v1/auth/github`}
          className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-2"
        >
          <GithubIcon />
          GitHub
        </a>
        <a
          href={`${apiBase}/v1/auth/google`}
          className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-2"
        >
          <GoogleIcon />
          Google
        </a>
      </div>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);
  const [serverError, setServerError] = React.useState<ApiError | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const data = await apiFetch<{ user: Parameters<typeof setSession>[0]; accessToken: string }>(
        "/v1/auth/login",
        { method: "POST", json: values, skipAuth: true, retryOn401: false },
      );
      setSession(data.user, data.accessToken);
      analytics.login("email");
      router.replace(params.get("next") ?? "/agent");
    } catch (err) {
      setServerError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Sign in failed"));
    }
  });

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-h1">Sign in</h1>
      <p className="mt-1 text-sm text-text-muted">Welcome back to AI Harness.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        {serverError ? <ErrorState error={serverError} /> : null}

        <Field label="Email" htmlFor="email" required error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
        </Field>

        <Field label="Password" htmlFor="password" required error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
        </Field>

        <Button type="submit" loading={isSubmitting} className="w-full">
          Sign in
        </Button>
      </form>

      <SocialLoginButtons />

      <div className="mt-6 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-text-secondary hover:text-brand">
          Forgot password?
        </Link>
        <Link href="/signup" className="text-brand hover:text-brand-hover">
          Create account
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center px-4 py-16">
      <React.Suspense fallback={null}>
        <LoginForm />
      </React.Suspense>
    </main>
  );
}
