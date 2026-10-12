"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { NoraLogo } from "@nora/ui";
import { AppHeader } from "@/components/app-header";
import { useAuth } from "@/lib/auth-context";

/**
 * Renders the signed-in chrome and sends visitors without a valid session to
 * sign in. Pages under this shell must load their data through the API, which
 * enforces authentication independently.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace(pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [state.status, router, pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      {state.status === "authenticated" ? (
        <AppHeader profile={state.profile} />
      ) : (
        <header className="h-16 border-b border-line bg-panel">
          <div className="mx-auto flex h-full max-w-[1600px] items-center px-4">
            <NoraLogo descriptor={false} />
            <span role="status" className="ml-auto text-secondary text-fg-muted">
              Checking your session…
            </span>
          </div>
        </header>
      )}
      <div className="flex-1" aria-busy={state.status !== "authenticated" || undefined}>
        {children}
      </div>
    </div>
  );
}
