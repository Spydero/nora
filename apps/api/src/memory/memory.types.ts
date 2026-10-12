export type MemoryKind = 'about' | 'condition' | 'medicine' | 'allergy' | 'past_check' | 'appointment';

/**
 * One thing Nora remembers about a patient. Items are built only from records
 * the patient or a clinician confirmed; models can read them by ID but never
 * create or change them.
 */
export interface MemoryItem {
  /** Stable within one assessment run, e.g. "M2". */
  id: string;
  kind: MemoryKind;
  label: string;
  text: string;
  recordedAt: string | null;
  /** Where the patient can see or correct the underlying record. */
  href: string;
  /** For past checks: the record it came from, its concern and its advice. */
  checkId?: string;
  concernCode?: string | null;
  urgency?: string | null;
}

export function memoryLine(item: MemoryItem): string {
  return `${item.id} ${item.label}: ${item.text}`;
}
