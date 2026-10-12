"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, TextField } from "@nora/ui";
import { ErrorSummary } from "@/components/auth-shell";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function LoginForm() {
  const { signIn } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSubmitting(true);
    setError(null);
    try {
      await signIn({
        tenantSlug: String(form.get("tenantSlug") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      // Next keeps this page's state for back navigation, so clear it before the next visitor signs in.
      formElement.reset();
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "NETWORK", "We could not reach Nora. Check your connection and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <ErrorSummary message={error.message} fields={error.fields} />}
      <div className="flex flex-col gap-4">
        <TextField label="Organisation code" name="tenantSlug" autoComplete="organization" defaultValue="demo" required />
        <TextField label="Email" name="email" type="email" autoComplete="username" required />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="mt-6 w-full" loading={submitting}>
        Sign in
      </Button>
      <p className="mt-4 text-center text-secondary text-fg-muted">
        New to Nora?{" "}
        <Link href="/register" className="font-medium text-brand-teal underline-offset-2 hover:underline">
          Create a patient account
        </Link>
      </p>
    </form>
  );
}
