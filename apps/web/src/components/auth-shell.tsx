import type { ReactNode } from "react";
import { Alert, NoraLogo } from "@nora/ui";

export function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <NoraLogo />
        </div>
        <div className="rounded-panel border border-line bg-panel p-6 sm:p-8">
          <h1 className="text-page-title font-semibold">{title}</h1>
          <p className="mt-2 text-secondary text-fg-muted">{description}</p>
          <div className="mt-6">{children}</div>
        </div>
        <div className="mt-6">
          <Alert status="danger" title="Need urgent help?">
            Call your local emergency number now. Do not wait to sign in.
          </Alert>
        </div>
      </div>
    </main>
  );
}

export function ErrorSummary({ message, fields }: { message: string; fields?: { field: string; message: string }[] }) {
  return (
    <div role="alert" tabIndex={-1} className="mb-5 rounded-card bg-danger-bg p-4 text-danger">
      <p className="font-semibold">{message}</p>
      {fields && fields.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-secondary">
          {fields.map((field) => (
            <li key={field.field}>{field.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
