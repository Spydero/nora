import type { CheckResult, FindingItem } from "./checks";

export function amount(value: number, unit: string | undefined): string {
  if (!unit) return String(value);
  if (unit === "days" && value === 0) return "less than a day";
  return `${value} ${value === 1 ? unit.replace(/s$/, "") : unit}`;
}

/** "Fever: 3 days", "Bitten or scratched by an animal · 5 days ago". */
export function findingText(f: FindingItem): string {
  const value = f.value !== undefined && f.value !== null ? `: ${amount(f.value, f.unit)}` : "";
  const ago = f.daysAgo === undefined ? "" : ` · ${f.daysAgo < 1 ? "today" : `${amount(f.daysAgo, "days")} ago`}`;
  return `${f.label}${value}${ago}`;
}

/**
 * The records listed under "From your records". Earlier checks are left out:
 * the follow-up and earlier-check notes at the top of the result already name
 * the one this check relates to.
 */
export function recordsShown(result: Pick<CheckResult, "memory">) {
  return result.memory?.filter((m) => m.used && m.kind !== "past_check") ?? [];
}
