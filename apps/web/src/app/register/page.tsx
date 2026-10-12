import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create a patient account"
      description="Your account is created with the care organisation that gave you its code."
    >
      <RegisterForm />
    </AuthShell>
  );
}
