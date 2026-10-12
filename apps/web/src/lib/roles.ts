import { CalendarDays, ClipboardCheck, ClipboardList, FileStack, Pill, Settings2, ShieldAlert, Stethoscope, type LucideIcon } from "lucide-react";
import type { Role } from "./auth-context";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const PATIENT_NAV: NavItem[] = [
  { href: "/", label: "Intake", icon: ClipboardList },
  { href: "/medicines", label: "Medicines", icon: Pill },
  { href: "/doctors", label: "Doctors", icon: Stethoscope },
  { href: "/appointments", label: "Appointments", icon: CalendarDays },
];

const REVIEW: NavItem = { href: "/review", label: "Review queue", icon: ClipboardCheck };
const ADMIN: NavItem = { href: "/admin", label: "Administration", icon: Settings2 };
const CONTENT: NavItem = { href: "/content", label: "Clinical content", icon: FileStack };
const PLATFORM: NavItem = { href: "/platform", label: "Platform", icon: ShieldAlert };
const MEDICINES = PATIENT_NAV[1]!;
const DOCTORS = PATIENT_NAV[2]!;

const isReviewer = (roles: Role[]) => roles.some((r) => r === "CLINICIAN" || r === "CLINICAL_APPROVER" || r === "CARE_COORDINATOR");

/** Patients get the care workspace; staff roles get their own tools and never the patient intake. */
export function navFor(roles: Role[]): NavItem[] {
  if (roles.includes("PATIENT")) return PATIENT_NAV;
  const items: NavItem[] = [];
  if (isReviewer(roles)) items.push(REVIEW);
  if (roles.includes("TENANT_ADMIN")) items.push(ADMIN);
  if (roles.includes("CLINICAL_CONTENT_EDITOR") || roles.includes("CLINICAL_APPROVER")) items.push(CONTENT);
  if (roles.includes("PLATFORM_OPERATOR")) items.push(PLATFORM);
  if (isReviewer(roles) || roles.includes("CLINICAL_CONTENT_EDITOR")) items.push(MEDICINES);
  if (isReviewer(roles) || roles.includes("TENANT_ADMIN")) items.push(DOCTORS);
  return items;
}

export function homeFor(roles: Role[]): string {
  return navFor(roles)[0]?.href ?? "/";
}

/** Routes each role may open. Anything else redirects to the role's home. */
export function canOpen(roles: Role[], pathname: string): boolean {
  if (roles.includes("PATIENT")) return !["/review", "/admin", "/content", "/platform"].some((p) => pathname.startsWith(p));
  if (["/settings", "/history", "/privacy", "/appointments"].some((p) => pathname.startsWith(p)) || pathname === "/") return false;
  return navFor(roles).some((item) => pathname.startsWith(item.href));
}

export const ROLE_LABEL: Record<Role, string> = {
  PATIENT: "Patient",
  CLINICIAN: "Clinician",
  CARE_COORDINATOR: "Care coordinator",
  TENANT_ADMIN: "Administrator",
  CLINICAL_CONTENT_EDITOR: "Content editor",
  CLINICAL_APPROVER: "Clinical approver",
  PLATFORM_OPERATOR: "Platform operator",
};
