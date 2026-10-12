"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, TextField } from "@nora/ui";
import { ErrorSummary } from "@/components/auth-shell";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fieldError = (name: string) => error?.fields.find((field) => field.field === name)?.message;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await register({
        tenantSlug: String(form.get("tenantSlug") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "NETWORK", "We could not reach Nora. Check your connection and try again."));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <ErrorSummary message={error.message} fields={error.fields} />}
      <div className="flex flex-col gap-4">
        <TextField label="Organisation code" name="tenantSlug" defaultValue="demo" error={fieldError("tenantSlug")} required />
        <TextField label="Full name" name="displayName" autoComplete="name" error={fieldError("displayName")} required />
        <TextField label="Email" name="email" type="email" autoComplete="email" error={fieldError("email")} required />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters. A short phrase is easier to remember."
          error={fieldError("password")}
          required
        />
      </div>
      <Button type="submit" className="mt-6 w-full" loading={submitting}>
        Create account
      </Button>
      <p className="mt-4 text-center text-secondary text-fg-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-teal underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
