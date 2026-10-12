import { describe, expect, it } from "vitest";
import { findingText, recordsShown } from "./findings";

describe("findings shown to the patient", () => {
  it("shows when each exposure happened, separately for each one", () => {
    expect(findingText({ key: "animal_bite", label: "Bitten or scratched by an animal", source: "rules", daysAgo: 5 })).toBe("Bitten or scratched by an animal · 5 days ago");
    expect(findingText({ key: "suspect_food", label: "Ate food that may have been unsafe", source: "rules", daysAgo: 1 })).toBe("Ate food that may have been unsafe · 1 day ago");
    expect(findingText({ key: "snake_bite", label: "Snake bite", source: "rules", daysAgo: 0 })).toBe("Snake bite · today");
    expect(findingText({ key: "new_exposure", label: "New medicine", source: "rules" })).toBe("New medicine");
    expect(findingText({ key: "duration_days", label: "How long", source: "rules", value: 3, unit: "days" })).toBe("How long: 3 days");
  });

  it("doesn’t list earlier checks under the records, where they would repeat the notes above", () => {
    const memory = [
      { id: "M1", kind: "allergy" as const, label: "Allergy", text: "Penicillin", href: "/settings", used: true },
      { id: "M2", kind: "past_check" as const, label: "Earlier check", text: "2 Oct — Sore throat.", href: "/history", checkId: "c0", used: true },
      { id: "M3", kind: "medicine" as const, label: "Current medicine", text: "Levothyroxine", href: "/settings", used: false },
    ];
    expect(recordsShown({ memory }).map((m) => m.id)).toEqual(["M1"]);
    expect(recordsShown({})).toEqual([]);
  });
});
