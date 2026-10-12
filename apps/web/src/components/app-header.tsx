"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ClipboardList, LogOut, Pill, Plus, Stethoscope } from "lucide-react";
import { Button, cn, NoraLogo } from "@nora/ui";
import { useAuth, type Profile } from "@/lib/auth-context";
import { CURRENT_CHECK_KEY, NEW_CHECK_EVENT } from "@/lib/checks";
import { initials } from "@/lib/names";

const NAV = [
  { href: "/", label: "Intake", icon: ClipboardList },
  { href: "/medicines", label: "Medicines", icon: Pill },
  { href: "/doctors", label: "Doctors", icon: Stethoscope },
  { href: "/appointments", label: "Appointments", icon: CalendarDays },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary mobile"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 text-meta font-medium",
                  active ? "text-brand-teal" : "text-fg-muted hover:text-fg",
                )}
              >
                <Icon aria-hidden className="size-5" strokeWidth={active ? 2.25 : 1.75} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function startNewCheck(pathname: string, router: ReturnType<typeof useRouter>) {
  sessionStorage.removeItem(CURRENT_CHECK_KEY);
  window.dispatchEvent(new Event(NEW_CHECK_EVENT));
  if (pathname !== "/") router.push("/");
}

export function AppHeader({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-20 h-16 border-b border-line bg-panel">
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4 px-4">
        <Link href="/" className="shrink-0 rounded-control" aria-label="Nora home">
          <NoraLogo descriptor={false} />
        </Link>
        <nav aria-label="Primary" className="hidden flex-1 md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-control px-3 text-secondary font-medium",
                      active ? "bg-subtle text-brand-navy" : "text-fg-muted hover:bg-subtle hover:text-fg",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" className="max-sm:hidden" onClick={() => startNewCheck(pathname, router)}>
            <Plus aria-hidden className="size-5" strokeWidth={2} />
            New check
          </Button>
          <ProfileMenu profile={profile} />
        </div>
      </div>
    </header>
  );
}

function ProfileMenu({ profile }: { profile: Profile }) {
  const { signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const avatarInitials = initials(profile.user.displayName);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 items-center gap-2 rounded-control px-2 hover:bg-subtle"
      >
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-brand-navy text-meta font-semibold text-fg-inverse">
          {avatarInitials}
        </span>
        <span className="hidden text-secondary font-medium lg:inline">{profile.user.displayName}</span>
        <ChevronDown aria-hidden className="size-4 text-fg-muted" />
        <span className="sr-only">Open profile menu</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 rounded-card border border-line bg-panel p-2 shadow-overlay">
          <div className="border-b border-line px-3 pb-3 pt-1">
            <p className="text-secondary font-semibold">{profile.user.displayName}</p>
            <p className="truncate text-meta text-fg-muted">{profile.user.email}</p>
            <p className="mt-1 text-meta text-fg-muted">{profile.tenant.name}</p>
          </div>
          {["Preferences", "History", "Privacy controls"].map((label) => (
            <button key={label} role="menuitem" type="button" disabled className="flex min-h-11 w-full items-center rounded-control px-3 text-left text-secondary text-fg-muted">
              {label}
            </button>
          ))}
          <button
            role="menuitem"
            type="button"
            onClick={handleSignOut}
            className="flex min-h-11 w-full items-center gap-2 rounded-control px-3 text-left text-secondary font-medium hover:bg-subtle"
          >
            <LogOut aria-hidden className="size-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
