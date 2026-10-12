import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthShell title="Sign in" description="Use the organisation code and account provided by your care organisation.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
