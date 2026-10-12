import { OctagonAlert, Phone } from "lucide-react";
import type { CheckView } from "@/lib/checks";

/** Shown above everything as soon as a check reaches emergency urgency. */
export function EmergencyBanner({ check }: { check: CheckView }) {
  const { number, crisisLine } = check.emergency;
  const crisis = crisisLine ? (check.result?.carePlan.some((item) => item.text.includes(crisisLine.number)) ?? false) : false;
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-card bg-danger p-4 text-fg-inverse sm:flex-row sm:items-center">
      <OctagonAlert aria-hidden className="size-7 shrink-0" />
      <div className="flex-1">
        <p className="text-card-title font-semibold">{check.result?.urgency.title ?? "Get emergency help now"}</p>
        <p className="text-secondary">Call {number} now, or go to the nearest emergency department. Do not drive yourself.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={`tel:${number}`} className="inline-flex min-h-11 items-center gap-2 rounded-control bg-panel px-4 font-semibold text-danger">
          <Phone aria-hidden className="size-4" />
          Call {number}
        </a>
        {crisis && crisisLine && (
          <a href={`tel:${crisisLine.number}`} className="inline-flex min-h-11 items-center gap-2 rounded-control border border-fg-inverse px-4 font-semibold">
            <Phone aria-hidden className="size-4" />
            {crisisLine.name} {crisisLine.number}
          </a>
        )}
      </div>
    </div>
  );
}
