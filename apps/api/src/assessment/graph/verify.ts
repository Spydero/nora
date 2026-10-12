import { type UrgencyLevel, urgencyRank } from '../../clinical/bundle.schema.js';
import { aboveLevelIssues, type AnswerFacts, answerIssues, urgencyIssues } from './consistency.js';

/**
 * What a model may write: a summary of what the patient reported and what the
 * rule-set next step means, plus questions for a clinician. Possible causes
 * are not part of it; general information is approved content shown as is.
 */
export interface Draft {
  summary: string;
  questionsForClinician: string[];
  /** Memory item IDs (e.g. "M2") the text relies on. */
  memoryRefs: string[];
}

/** Conditions and causes a draft must not attach to the patient's symptoms. */
const CONDITION =
  '(infections?|virus(es)?|viral|bacteria|bacterial|strep|tonsillitis|pharyngitis|migraines?|tension[- ]type|appendicitis|cystitis|uti|kidney infection|pyelonephritis|pneumonia|bronchitis|meningitis|sciatica|gastroenteritis|stomach bug|food poisoning|indigestion|acidity|gastritis|dermatitis|eczema|allerg(y|ies|ic reaction)|hives|urticaria|otitis|ear infection|vertigo|bppv|labyrinthitis|flu|influenza|common cold|dengue|malaria|typhoid|covid|stroke|heart attack|sepsis|anaphylaxis|cancer|tumou?r|rabies)';

const DIAGNOSIS = [
  /\bdiagnos(is|ed|e|ing)\b/i,
  /\byou (definitely|certainly|clearly) have\b/i,
  new RegExp(`\\b(you have|you've got|this is|it is|it's) (a |an )?(\\w+ ){0,3}${CONDITION}\\b`, 'i'),
];

/** Guessing at a cause, or ranking causes, is diagnosis by another name. */
const SPECULATION = [
  /\b(most|more|less|least|highly) likely\b/i,
  /\blikelihood\b/i,
  new RegExp(
    `\\b(may|might|could|can|likely|probably|possibly|perhaps|suggests?|suggestive of|points? (to|towards)|consistent with|sounds like|looks like|indicates?|due to|caused by|because of|signs? of|considers?|consider|rule out)\\b[^.?!]{0,50}\\b${CONDITION}\\b`,
    'i',
  ),
];

/** Saying what Nora is not ("this is not a diagnosis") is required wording, not a diagnosis. */
const DISCLAIMER = /\b(not|never|cannot|can't|can not|isn't|is not|without|doesn't|does not)\s+(give\s+|make\s+|provide\s+|replace\s+)?(you\s+)?(a\s+|any\s+)?diagnos\w*/gi;

const DOSING = [/\b\d+(\.\d+)?\s?(mg|mcg|µg|ml|g|iu|tablets?|tabs?|capsules?|puffs?|drops?)\b/i, /\b(times|twice|three times) (a|per) day\b/i];

/** Instructions are only checked in Nora's statements; patients may ask a clinician about their medicines. */
const MEDICINE_INSTRUCTION =
  /\b(take|start|stop|increase|decrease|double|skip)\s+(\w+\s+){0,2}(antibiotics?|ibuprofen|paracetamol|amoxicillin|azithromycin|medications?|medicines?|dose|pills?|tablets?)\b/i;

const FALSE_REASSURANCE = [
  /\b(no need|don't need|do not need|needn't)\s+(to\s+)?(see|visit|contact|call|go)\b/i,
  /\bnothing (serious|to worry)\b/i,
  /\b(definitely|certainly) (not|nothing)\b/i,
  /\bnot (urgent|serious)\b/i,
];

/** Patient-facing text must speak to the patient, not about them. */
const THIRD_PERSON = [
  /\bthe (patient|user|individual|person)\b/i,
  /\b(he|she) (has|is|was|had|should|reports?|describes?|denies|needs?|may|might|can)\b/i,
  /\b(his|her) (symptoms?|throat|fever|pain|glands?|cough|headache|age)\b/i,
  /\ban? \d{1,3}[-‑ ]year[-‑ ]old\b/i,
];

/** Statements about the patient's past or records; these must cite a memory item. */
const HISTORY_CLAIM = [
  /\b(last time|previously|your (last|previous|earlier|recent) (check|visit|assessment|appointment)|you (have|had) (a )?history|you('ve| have) had (this|it|something similar) before|keeps? coming back|recurring|recurrent)\b/i,
  /\byou (take|are taking|are on|have been taking)\b/i,
  /\byour (medicines?|medications?|tablets?|allergy|allergies|condition|conditions|records?|upcoming appointment)\b/i,
  /\b(you are|you're) allergic\b/i,
];

export interface VerifyContext {
  citationIds: ReadonlySet<string>;
  urgency: UrgencyLevel;
  /** IDs of the memory items given to the model. */
  memoryIds?: ReadonlySet<string>;
  /** Everything the model was allowed to know: memory text, evidence text, candidate labels. */
  groundText?: string;
  /** Medicine and condition names that must not appear unless the ground text contains them. */
  watchTerms?: readonly string[];
  /** The patient's own answers; the draft must not contradict them. */
  answers?: AnswerFacts;
}

const wordRe = (term: string) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');

/** History claims need memory; named medicines or conditions must come from memory or evidence. */
function groundingIssues(draft: Draft, texts: string[], ctx: VerifyContext): string[] {
  const issues: string[] = [];
  const ids = ctx.memoryIds ?? new Set<string>();
  for (const ref of draft.memoryRefs) if (!ids.has(ref)) issues.push(`Memory item ${ref} does not exist.`);
  if (draft.memoryRefs.length === 0) {
    for (const t of texts) {
      if (HISTORY_CLAIM.some((re) => re.test(t))) issues.push(`Refers to your history or records without citing a memory item: "${t.slice(0, 80)}"`);
    }
  }
  const ground = (ctx.groundText ?? '').toLowerCase();
  for (const term of ctx.watchTerms ?? []) {
    const re = wordRe(term);
    if (!ground.includes(term.toLowerCase()) && texts.some((t) => re.test(t))) issues.push(`Mentions "${term}", which is not in your records or the approved sources.`);
  }
  return issues;
}

/** Deterministic safety and provenance checks applied to every draft. */
export function verifyDraft(draft: Draft, ctx: VerifyContext): string[] {
  const issues: string[] = [];
  for (const c of new Set(draft.summary.match(/\bE\d+\b/g) ?? [])) if (!ctx.citationIds.has(c)) issues.push(`Citation ${c} was not retrieved in this run.`);

  const texts = [draft.summary, ...draft.questionsForClinician];
  for (const t of texts) {
    if (DIAGNOSIS.some((re) => re.test(t.replace(DISCLAIMER, '')))) issues.push(`Diagnostic language is not allowed: "${t.slice(0, 80)}"`);
    if (SPECULATION.some((re) => re.test(t))) issues.push(`Guessing at or ranking possible causes is not allowed: "${t.slice(0, 80)}"`);
    if (DOSING.some((re) => re.test(t))) issues.push(`Medicine dosing or instructions are not allowed: "${t.slice(0, 80)}"`);
    if (urgencyRank(ctx.urgency) >= urgencyRank('soon') && FALSE_REASSURANCE.some((re) => re.test(t))) {
      issues.push(`Text contradicts the required urgency: "${t.slice(0, 80)}"`);
    }
  }
  const statements = [draft.summary];
  for (const t of statements) {
    if (MEDICINE_INSTRUCTION.test(t)) issues.push(`Medicine dosing or instructions are not allowed: "${t.slice(0, 80)}"`);
    if (THIRD_PERSON.some((re) => re.test(t))) issues.push(`Address the patient directly as "you": "${t.slice(0, 80)}"`);
  }
  issues.push(...urgencyIssues(statements, ctx.urgency));
  issues.push(...aboveLevelIssues(statements, ctx.urgency));
  if (ctx.answers) issues.push(...answerIssues(statements, ctx.answers));
  issues.push(...groundingIssues(draft, texts, ctx));
  return issues;
}
