import { type Draft, verifyDraft } from './verify.js';

const ctx = { candidateCodes: new Set(['viral_pharyngitis']), citationIds: new Set(['E1']), urgency: 'soon' as const };
const draft = (summary: string, rationale = 'Your runny nose fits a viral cause (E1).', extra: Partial<Draft> = {}): Draft => ({
  summary,
  explanations: [{ code: 'viral_pharyngitis', likelihood: 'possible', rationale, citations: ['E1'] }],
  questionsForClinician: [],
  memoryRefs: [],
  ...extra,
});

describe('memory grounding', () => {
  const grounded = {
    ...ctx,
    memoryIds: new Set(['M1', 'M2']),
    groundText: 'Penicillin\nLevothyroxine\nMost sore throats are caused by viruses.',
    watchTerms: ['amoxicillin', 'penicillin', 'levothyroxine', 'metformin', 'diabetes'],
  };

  it('accepts history that cites a memory item', () => {
    const d = draft('You have a sore throat. Because you are allergic to penicillin, tell the doctor before any medicine is prescribed.', undefined, { memoryRefs: ['M1'] });
    expect(verifyDraft(d, grounded)).toEqual([]);
  });

  it('rejects history claims without a memory reference', () => {
    const cases = ['Your sore throat keeps coming back, so see a doctor within 24–48 hours.', 'You are allergic to penicillin, so mention it to the doctor.', 'Since you take levothyroxine, a doctor should check this within 24–48 hours.'];
    for (const summary of cases) expect(verifyDraft(draft(summary), grounded).join(' ')).toMatch(/without citing a memory item/);
  });

  it('rejects memory IDs that were never provided', () => {
    expect(verifyDraft(draft('You have a sore throat; see a doctor within 24–48 hours.', undefined, { memoryRefs: ['M7'] }), grounded).join(' ')).toMatch(/M7 does not exist/);
  });

  it('rejects medicines or conditions that are not in records or evidence', () => {
    const d = draft('You have a sore throat; see a doctor within 24–48 hours.', 'With diabetes, a viral cause still fits your runny nose (E1).', { questionsForClinician: ['Should I avoid metformin?'], memoryRefs: ['M1'] });
    const issues = verifyDraft(d, grounded).join(' ');
    expect(issues).toMatch(/"diabetes"/);
    expect(issues).toMatch(/"metformin"/);
    expect(issues).not.toMatch(/"penicillin"/);
  });
});

describe('draft verification', () => {
  it('accepts a cited, second-person draft', () => {
    expect(verifyDraft(draft('You have had a sore throat for three days. Please see a doctor within 24–48 hours.'), ctx)).toEqual([]);
  });

  it('rejects drafts that talk about the patient instead of to them', () => {
    const cases = [
      'A 36‑year‑old man has a sore throat for three days. He should see a doctor soon.',
      'The patient reports a sore throat and should see a doctor within 24–48 hours.',
      'She has a fever and swollen glands, so a doctor should check this within two days.',
    ];
    for (const summary of cases) expect(verifyDraft(draft(summary), ctx).join(' ')).toMatch(/Address the patient directly/);
  });

  it('checks rationales as well as the summary', () => {
    const issues = verifyDraft(draft('You should see a doctor within 24–48 hours.', 'His symptoms fit a viral cause (E1).'), ctx);
    expect(issues.join(' ')).toMatch(/Address the patient directly/);
  });

  it('allows disclaimers but still rejects diagnoses', () => {
    const disclaimers = [
      'You should see a doctor within 24–48 hours. The possible explanations below are not a diagnosis.',
      'Nora cannot diagnose you; a doctor within 24–48 hours can check this.',
    ];
    for (const summary of disclaimers) expect(verifyDraft(draft(summary), ctx)).toEqual([]);

    expect(verifyDraft(draft('You have been diagnosed with strep throat. See a doctor within 24–48 hours.'), ctx).join(' ')).toMatch(/Diagnostic language/);
    expect(verifyDraft(draft('This is not a diagnosis, but you have tonsillitis.'), ctx).join(' ')).toMatch(/Diagnostic language/);
  });

  it('lets the patient ask a clinician about their medicines but not Nora give instructions', () => {
    const asking = { ...draft('You should see a doctor within 24–48 hours.'), questionsForClinician: ['Should I stop my levothyroxine while I am unwell?'] };
    expect(verifyDraft(asking, ctx)).toEqual([]);

    const instructing = verifyDraft(draft('Stop your medicines and see a doctor within 24–48 hours.'), ctx);
    expect(instructing.join(' ')).toMatch(/dosing or instructions/);

    const dosing = { ...asking, questionsForClinician: ['Should I take 500 mg of paracetamol?'] };
    expect(verifyDraft(dosing, ctx).join(' ')).toMatch(/dosing or instructions/);
  });
});
