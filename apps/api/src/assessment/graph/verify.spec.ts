import { type Draft, verifyDraft } from './verify.js';

const ctx = { candidateCodes: new Set(['viral_pharyngitis']), citationIds: new Set(['E1']), urgency: 'soon' as const };
const draft = (summary: string, rationale = 'Your runny nose fits a viral cause (E1).'): Draft => ({
  summary,
  explanations: [{ code: 'viral_pharyngitis', likelihood: 'possible', rationale, citations: ['E1'] }],
  questionsForClinician: [],
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
