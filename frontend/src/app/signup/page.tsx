"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { signupRequestSchema, type SignupRequest } from "@ai-harness/contracts";
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

export default function SignupPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [serverError, setServerError] = useState<ApiError | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupRequest>({
    resolver: zodResolver(signupRequestSchema),
    defaultValues: { email: "", password: "", displayName: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const data = await apiFetch<{ user: Parameters<typeof setSession>[0]; accessToken: string }>(
        "/v1/auth/signup",
        { method: "POST", json: values, skipAuth: true, retryOn401: false },
      );
      setSession(data.user, data.accessToken);
      analytics.signup("email");
      router.replace("/onboarding");
    } catch (err) {
      setServerError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Signup failed"));
    }
  });

  return (
    <main className="flex min-h-dvh items-center px-4 py-16">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-h1">Create your account</h1>
        <p className="mt-1 text-sm text-text-muted">
          Your workspaces, providers and agent history stay tied to this account.
        </p>

        <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
          {serverError ? <ErrorState error={serverError} /> : null}

          <Field label="Display name" htmlFor="displayName" required error={errors.displayName?.message}>
            <Input id="displayName" autoComplete="name" {...register("displayName")} />
          </Field>
          <Field label="Email" htmlFor="email" required error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            required
            error={errors.password?.message}
          >
            <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
          </Field>
          <p className="text-xs text-text-muted">
            At least 10 characters with upper case, lower case and a digit.
          </p>

          <Button type="submit" loading={isSubmitting} className="w-full">
            Create account
          </Button>
        </form>

        <SocialLoginButtons />

        <p className="mt-6 text-sm text-text-secondary">
          Already have an account?{" "}
          <Link href="/login" className="text-brand hover:text-brand-hover">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
