"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";

export type Role =
  | "PATIENT"
  | "CLINICIAN"
  | "CARE_COORDINATOR"
  | "TENANT_ADMIN"
  | "CLINICAL_CONTENT_EDITOR"
  | "CLINICAL_APPROVER"
  | "PLATFORM_OPERATOR";

export interface Profile {
  user: { id: string; email: string; displayName: string };
  tenant: {
    id: string;
    slug: string;
    name: string;
    emergency: { number: string; crisisLine: { name: string; number: string } | null };
  };
  roles: Role[];
  session: { id: string; idleTimeoutMinutes: number };
}

export interface LoginInput {
  tenantSlug: string;
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  displayName: string;
}

type AuthState =
  | { status: "loading"; profile: null }
  | { status: "authenticated"; profile: Profile }
  | { status: "unauthenticated"; profile: null };

interface AuthContextValue {
  state: AuthState;
  signIn(input: LoginInput): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", profile: null });

  useEffect(() => {
    let cancelled = false;
    api<Profile>("/auth/me")
      .then((profile) => !cancelled && setState({ status: "authenticated", profile }))
      .catch((error: unknown) => {
        if (cancelled) return;
        if (!(error instanceof ApiError) || error.status !== 401) console.error(error);
        setState({ status: "unauthenticated", profile: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (input: LoginInput) => {
    const profile = await api<Profile>("/auth/login", { method: "POST", body: input });
    setState({ status: "authenticated", profile });
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const profile = await api<Profile>("/auth/register", { method: "POST", body: input });
    setState({ status: "authenticated", profile });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api<void>("/auth/logout", { method: "POST" });
    } finally {
      setState({ status: "unauthenticated", profile: null });
    }
  }, []);

  const value = useMemo(() => ({ state, signIn, register, signOut }), [state, signIn, register, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
