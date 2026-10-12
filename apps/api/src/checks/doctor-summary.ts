import type { AnswerConflict, FindingItem, ResultContent } from '../assessment/result.types.js';
import { quantity } from '../clinical/rules-engine.js';
import type { ProfileList } from '../memory/history-facts.js';

export interface DoctorSummaryInput {
  checkId: string;
  createdAt: Date;
  /** When Nora produced the advice shown. */
  assessedAt: Date;
  patient: { name: string | null; age: number | null; sexAtBirth: string | null };
  profile: { conditions: ProfileList | null; medications: ProfileList | null; allergies: ProfileList | null } | null;
  /** What the patient wrote in their own words, oldest first. */
  ownWords: string[];
  /** Nora's questions and the answers as the patient gave them, in order. */
  answers: { question: string; answer: string }[];
  /** The patient's reply to "Is there anything else you'd like us to know?". */
  additional: string[];
  result: ResultContent;
  review: { status: 'pending' | 'reviewed' | 'corrected'; clinician: string | null; correctedUrgency: string | null; patientNote: string | null } | null;
  urgencyTitles: Record<string, string>;
  now: Date;
}

export interface DoctorSummarySection {
  id: string;
  heading: string;
  text: string;
}

export interface DoctorSummary {
  checkId: string;
  title: string;
  generatedAt: string;
  /** Preparation date in India time as YYYY-MM-DD, for file names. */
  fileDate: string;
  sections: DoctorSummarySection[];
}

const LIKELIHOOD: Record<string, string> = { more_likely: 'more likely', possible: 'possible', less_likely: 'less likely' };
const SEX: Record<string, string> = { MALE: 'male', FEMALE: 'female', INTERSEX: 'intersex' };
const GAP: Record<string, string> = { unsure: 'patient unsure', skipped: 'patient skipped', not_asked: 'not asked' };
export const SUMMARY_TIME_ZONE = 'Asia/Kolkata';

const date = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: SUMMARY_TIME_ZONE });
const dateTime = (d: Date) =>
  `${date(d)}, ${d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: SUMMARY_TIME_ZONE })} IST`;
const isoDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: SUMMARY_TIME_ZONE });
const bullets = (lines: string[], empty: string) => (lines.length ? lines.map((l) => `- ${l}`).join('\n') : empty);
const finding = (f: FindingItem) => (f.value !== undefined && f.value !== null ? `${f.label}: ${quantity(f.value, f.unit)}` : f.label);

function profileList(list: ProfileList | null | undefined, label: string): string {
  switch (list?.state) {
    case 'known':
      return `${label}: ${(list.items ?? []).join('; ') || 'none listed'}`;
    case 'none':
      return `${label}: none`;
    case 'declined':
      return `${label}: patient chose not to share`;
    default:
      return `${label}: not recorded`;
  }
}

function conflictLine(c: AnswerConflict): string {
  const before = c.answeredIn === 'profile' ? `profile ${c.answered === 'yes' ? 'lists' : 'does not list'} it` : `answered “${c.answered}”`;
  const outcome = c.resolution === 'treated_as_present' ? 'treated as present for safety' : 'original answer kept';
  return `${c.label}: ${before}, later message ${c.mentioned === 'yes' ? 'mentions it' : 'suggests it is absent'} (${outcome})`;
}

function explainedBy(r: ResultContent): string {
  if (r.generator === 'llm') return `Written by AI${r.model ? ` (${r.model})` : ''} from approved guidance and checked by Nora. It cannot change the urgency above.`;
  if (r.generator === 'rules') return 'Nora’s clinical rules only; no AI was used.';
  return 'Nora’s standard approved guidance; no AI text is included.';
}

function recommendations(r: ResultContent): string[] {
  const steps = r.carePlan.filter((c) => !c.watch);
  const watch = r.carePlan.filter((c) => c.watch);
  return [
    `Next step: ${r.urgency.title}. ${r.urgency.text}`,
    ...steps.map((c) => `${c.whileWaiting ? 'Until seen: ' : ''}${c.text}${c.timeframe ? ` (${c.timeframe})` : ''}`),
    ...watch.map((c) => `Watch for: ${c.text}`),
  ];
}

/**
 * A summary a patient can take to a doctor. It contains only what the patient
 * confirmed in this consultation, their recorded history, Nora's rule-based
 * decision with its reasons, and the explanation kept apart from it; every
 * section is plain text so the patient can correct it before sharing.
 */
export function buildDoctorSummary(input: DoctorSummaryInput): DoctorSummary {
  const r = input.result;
  const { name, age, sexAtBirth } = input.patient;
  const who = [name, age !== null ? `${age} years` : null, sexAtBirth ? SEX[sexAtBirth] : null].filter(Boolean).join(', ');
  const history = r.findings.history;
  const evidence = [...new Map(r.evidence.map((e) => [e.sourceKey, e])).values()];
  const level = input.review?.correctedUrgency ?? r.urgency.level;
  const missingSafety = r.triage?.missingSafety ?? [];

  const sections: DoctorSummarySection[] = [
    {
      id: 'patient',
      heading: 'Patient',
      text: [
        `${who || 'Name not recorded'}`,
        `Check started: ${dateTime(input.createdAt)}`,
        `Assessed: ${dateTime(input.assessedAt)}`,
        `Concern: ${r.concerns.map((c) => c.label).join(', ') || 'not identified'}`,
      ].join('\n'),
    },
    {
      id: 'reason',
      heading: 'Reason for consultation (patient’s own words)',
      text: input.ownWords.length ? input.ownWords.map((w) => `“${w.trim()}”`).join('\n') : 'The patient answered Nora’s questions without a written description.',
    },
  ];
  if (r.episode) {
    sections.push({
      id: 'earlier',
      heading: 'Earlier check for the same problem',
      text: [r.episode.earlier.text, r.episode.label].join('\n'),
    });
  }
  sections.push(
    { id: 'symptoms', heading: 'Symptoms reported', text: bullets(r.findings.present.map(finding), 'None reported.') },
    { id: 'negatives', heading: 'Symptoms the patient does not have', text: bullets(r.findings.absent.map(finding), 'None recorded.') },
    {
      id: 'uncertain',
      heading: 'Not sure, skipped or not yet asked',
      text: bullets([...new Set([...r.findings.unknown.map(finding), ...r.missingInformation.map((m) => m.label)])], 'Nothing outstanding.'),
    },
    {
      id: 'history',
      heading: 'Medical history, medicines and allergies',
      text: [
        profileList(input.profile?.conditions, 'Conditions'),
        profileList(input.profile?.medications, 'Medicines'),
        profileList(input.profile?.allergies, 'Allergies'),
        ...(history?.present.length ? [`Relevant to this consultation: ${history.present.map(finding).join('; ')}`] : []),
        ...(history?.absent.length ? [`Patient does not have: ${history.absent.map(finding).join('; ')}`] : []),
      ].join('\n'),
    },
    {
      id: 'answers',
      heading: 'Questions Nora asked and the answers given',
      text: bullets(
        input.answers.map((a) => `${a.question} — ${a.answer}`),
        'Nora did not need to ask any questions.',
      ),
    },
    {
      id: 'assessment',
      heading: 'Urgency (decided by Nora’s clinical rules)',
      text: [
        `Urgency: ${input.urgencyTitles[level] ?? level}${input.review?.correctedUrgency ? ' (set by a reviewing clinician)' : ''}`,
        ...(r.urgency.reasons.length ? ['Why:', ...r.urgency.reasons.map((x) => `- ${x.message}`)] : []),
        ...(missingSafety.length ? ['Warning signs not ruled out:', ...missingSafety.map((m) => `- ${m.label} (${GAP[m.gap] ?? m.gap})`)] : []),
      ].join('\n'),
    },
    {
      id: 'explanation',
      heading: 'Explanation (cannot change the urgency)',
      text: [
        r.summary,
        ...(r.explanations.length
          ? [
              'Possible explanations (not a diagnosis):',
              ...r.explanations.map(
                (e) => `- ${e.label}${e.clinical && e.clinical !== e.label ? ` (${e.clinical})` : ''}: ${LIKELIHOOD[e.likelihood] ?? e.likelihood}. ${e.rationale.replace(/\s*\[?E\d+\]?/g, '')}`,
              ),
            ]
          : []),
        explainedBy(r),
      ].join('\n'),
    },
    { id: 'recommendations', heading: 'Recommendations', text: bullets(recommendations(r), 'None.') },
  );

  if (r.answerConflicts?.length) {
    sections.push({ id: 'changes', heading: 'Answers that changed during the consultation', text: bullets(r.answerConflicts.map(conflictLine), '') });
  }
  if (input.review && input.review.status !== 'pending') {
    sections.push({
      id: 'review',
      heading: 'Clinician review',
      text: [`Reviewed by ${input.review.clinician ?? 'a clinician'}${input.review.correctedUrgency ? `; urgency changed to ${input.urgencyTitles[input.review.correctedUrgency] ?? input.review.correctedUrgency}` : ''}.`, ...(input.review.patientNote ? [input.review.patientNote] : [])].join('\n'),
    });
  }
  sections.push(
    { id: 'questions', heading: 'Questions for the doctor', text: bullets(r.questionsForClinician, 'None.') },
    { id: 'notes', heading: 'Anything else the patient wants to add', text: input.additional.map((a) => a.trim()).join('\n') },
    { id: 'sources', heading: 'Guidance Nora used', text: bullets(evidence.map((e) => `${e.title} — ${e.publisher}${e.url ? ` (${e.url})` : ''}`), 'None.') },
    {
      id: 'disclaimer',
      heading: 'About this summary',
      text: `Prepared on ${date(input.now)} by Nora, an AI symptom checker, from what the patient reported. Urgency comes from Nora’s clinical rules; AI only helps explain it. It is not a diagnosis and has not been checked by a doctor unless a clinician review is shown above. The patient may have edited it before sharing.`,
    },
  );

  return {
    checkId: input.checkId,
    title: `Consultation summary — ${r.concerns.map((c) => c.label).join(', ') || 'symptom check'}`,
    generatedAt: input.now.toISOString(),
    fileDate: isoDate(input.now),
    sections,
  };
}
