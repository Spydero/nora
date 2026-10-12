"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { NoraLogo } from "@nora/ui";
import { AppHeader, MobileNav } from "@/components/app-header";
import { useAuth } from "@/lib/auth-context";
import { canOpen, homeFor } from "@/lib/roles";

/**
 * Renders the signed-in chrome and sends visitors without a valid session to
 * sign in. Pages under this shell must load their data through the API, which
 * enforces authentication independently.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const allowed = state.status === "authenticated" && canOpen(state.profile.roles, pathname);

  useEffect(() => {
    if (state.status === "unauthenticated") {
      const resume = !state.signedOut && pathname !== "/";
      router.replace(resume ? `/login?next=${encodeURIComponent(pathname)}` : "/login");
    } else if (state.status === "authenticated" && !allowed) {
      router.replace(homeFor(state.profile.roles));
    }
  }, [state, allowed, router, pathname]);

  if (state.status !== "authenticated") return <AppShellFallback />;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader profile={state.profile} />
      <div className="flex-1 max-md:pb-16">{allowed && children}</div>
      <MobileNav profile={state.profile} />
    </div>
  );
}

export function AppShellFallback() {
  return (
    <div className="flex min-h-screen flex-col" aria-busy>
      <header className="h-16 border-b border-line bg-panel">
        <div className="mx-auto flex h-full max-w-[1600px] items-center px-4">
          <NoraLogo descriptor={false} />
          <span role="status" className="ml-auto text-secondary text-fg-muted">
            Checking your session…
          </span>
        </div>
      </header>
    </div>
  );
}
