import { describe, expect, it } from "vitest";
import type { DoctorSummary } from "./checks";
import { pdfSafe, summaryPdf } from "./summary-pdf";

const summary: DoctorSummary = {
  checkId: "c1",
  title: "Consultation summary – Aarav Sharma",
  generatedAt: "2026-10-12T19:30:00Z",
  fileDate: "2026-10-13",
  sections: [
    { id: "patient", heading: "Patient", text: "Aarav Sharma, 34 years, male" },
    { id: "symptoms", heading: "Symptoms reported", text: "- Fever — patient’s words: “fever since yesterday”" },
    { id: "exposures", heading: "Exposures reported (not symptoms)", text: "- Bitten or scratched by an animal — patient’s words: “a dog bit me 5 days ago”" },
    { id: "answers", heading: "Questions Nora asked and the answers given", text: Array.from({ length: 80 }, (_, i) => `- Question ${i + 1} — No`).join("\n") },
    { id: "notes", heading: "Notes", text: "" },
    { id: "disclaimer", heading: "About this summary", text: "It is not a diagnosis." },
  ],
};

/** jsPDF writes text uncompressed, so drawn strings appear in the file as "(text) Tj", with parentheses escaped. */
const drawn = (text: string) => `(${text.replace(/[()\\]/g, (c) => `\\${c}`)})`;

async function pdfText(edits: Record<string, string> = {}): Promise<string> {
  const blob = await summaryPdf(summary, edits);
  return Buffer.from(await blob.arrayBuffer()).toString("latin1");
}

describe("doctor summary PDF", () => {
  it("is a valid multi-page PDF with every non-empty section and page numbers", async () => {
    const pdf = await pdfText();
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    for (const heading of ["Patient", "Symptoms reported", "Exposures reported (not symptoms)", "About this summary"]) expect(pdf).toContain(drawn(heading));
    expect(pdf).not.toContain(drawn("Notes"));
    expect(pdf).toMatch(/\(Page 1 of [2-9]\)/);
    expect(pdf).toContain(drawn("Nora consultation summary - not a diagnosis"));
  });

  it("keeps the patient’s words and swaps punctuation the built-in fonts can’t draw", async () => {
    const pdf = await pdfText();
    expect(pdf).toContain('"a dog bit me 5 days ago"');
    expect(pdf).toContain("patient's words");
    expect(pdfSafe("38 °C – “ok” … ₹500 ≥ 2")).toBe('38 °C - "ok" ... Rs 500 >= 2');
    expect(pdfSafe("तापमान")).toBe("??????");
  });

  it("applies the patient’s edits and says the summary was edited", async () => {
    const pdf = await pdfText({ symptoms: "- Fever for one day" });
    expect(pdf).toContain(drawn("- Fever for one day"));
    expect(pdf).not.toContain("fever since yesterday");
    expect(pdf).toContain("edited by the patient");
    expect(await pdfText()).not.toContain("edited by the patient");
  });
});
