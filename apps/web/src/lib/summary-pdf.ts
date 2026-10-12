import { formatDate } from "./care";
import type { DoctorSummary } from "./checks";

/** The built-in PDF fonts only cover Latin-1, so typographic punctuation is swapped for plain equivalents. */
const PLAIN: [RegExp, string][] = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[–—−]/g, "-"],
  [/…/g, "..."],
  [/≥/g, ">="],
  [/≤/g, "<="],
  [/₹/g, "Rs "],
  [/\u00a0/g, " "],
];

export function pdfSafe(text: string): string {
  const swapped = PLAIN.reduce((s, [re, to]) => s.replace(re, to), text);
  return [...swapped].map((c) => (c.charCodeAt(0) <= 0xff ? c : "?")).join("");
}

const PAGE = { width: 210, height: 297, margin: 18 };
const LINE = 5.2;

/**
 * Builds the doctor summary as a PDF with the patient's own edits applied:
 * every section as plain text, page numbers and the preparation date on each
 * page.
 */
export async function summaryPdf(summary: DoctorSummary, edits: Record<string, string>): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const width = PAGE.width - PAGE.margin * 2;
  const bottom = PAGE.height - PAGE.margin - 8;
  let y = PAGE.margin;

  const room = (needed: number) => {
    if (y + needed <= bottom) return;
    doc.addPage();
    y = PAGE.margin;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  for (const line of doc.splitTextToSize(pdfSafe(summary.title), width) as string[]) {
    doc.text(line, PAGE.margin, y + 6);
    y += 7.5;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  const edited = summary.sections.some((s) => edits[s.id] !== undefined && edits[s.id] !== s.text);
  doc.text(pdfSafe(`Prepared ${formatDate(summary.generatedAt, true)} IST by Nora${edited ? " - edited by the patient" : ""}`), PAGE.margin, y + 3);
  doc.setTextColor(0);
  y += 9;

  for (const section of summary.sections) {
    const text = (edits[section.id] ?? section.text).trim();
    if (!text) continue;
    const lines = doc.splitTextToSize(pdfSafe(text), width) as string[];
    room(LINE * 2 + Math.min(lines.length, 3) * LINE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(pdfSafe(section.heading), PAGE.margin, y + 4);
    y += LINE + 1.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(section.id === "disclaimer" ? 8.5 : 10);
    for (const line of lines) {
      room(LINE);
      doc.text(line, PAGE.margin, y + 4);
      y += LINE;
    }
    y += 3.5;
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text("Nora consultation summary - not a diagnosis", PAGE.margin, PAGE.height - 10);
    doc.text(`Page ${page} of ${pages}`, PAGE.width - PAGE.margin, PAGE.height - 10, { align: "right" });
  }
  return doc.output("blob");
}
