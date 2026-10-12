import type { ResultContent } from '../assessment/result.types.js';
import { buildDoctorSummary, type DoctorSummaryInput } from './doctor-summary.js';

const result = {
  schemaVersion: '1',
  status: 'COMPLETED',
  urgency: { level: 'soon', title: 'See a doctor within 24–48 hours', text: '', reasons: [{ ruleId: 'r_sore_throat_long', message: 'A sore throat that does not improve after a week should be checked by a doctor.', citations: ['E1'] }] },
  summary: 'You have a sore throat with fever.',
  concerns: [{ code: 'sore_throat', label: 'Sore throat' }],
  findings: {
    present: [{ key: 'sore_throat', label: 'Sore throat', source: 'llm' }, { key: 'temperature_c', label: 'Highest temperature', value: 38.5, unit: '°C', source: 'answer' }],
    absent: [{ key: 'cough', label: 'Cough', source: 'answer' }],
    unknown: [{ key: 'tonsil_pus', label: 'White patches or pus on the tonsils', source: 'answer' }],
    history: { present: [{ key: 'chronic_lung_disease', label: 'Long-term lung condition', source: 'profile' }], absent: [], unknown: [] },
  },
  information: [{ code: 'info_sore_throat', title: 'About sore throats', text: 'Most sore throats get better on their own within a week.', citations: ['E1'] }],
  answerConflicts: [{ key: 'blood_thinners', label: 'Takes blood thinners', answered: 'no', mentioned: 'yes', resolution: 'treated_as_present', answeredIn: 'profile' }],
  carePlan: [],
  questionsForClinician: ['Do I need a throat swab?'],
  missingInformation: [],
  limitations: [],
  handoff: { recommended: true, specialty: 'General practice', timeframe: '24–48 hours' },
  evidence: [
    { citationId: 'E1', chunkId: 'c1', documentId: 'd1', sourceKey: 'src_sore_throat', version: 2, title: 'Sore throat in adults', publisher: 'Based on NHS guidance (nhs.uk)', heading: null, excerpt: '', url: 'https://www.nhs.uk/conditions/sore-throat/' },
    { citationId: 'E2', chunkId: 'c2', documentId: 'd1', sourceKey: 'src_sore_throat', version: 2, title: 'Sore throat in adults', publisher: 'Based on NHS guidance (nhs.uk)', heading: null, excerpt: '', url: 'https://www.nhs.uk/conditions/sore-throat/' },
  ],
  disclaimer: '',
  emergency: { number: '112', crisisLine: null },
  generator: 'llm',
  model: null,
  verification: { passed: true, attempts: 1, issues: [] },
} satisfies ResultContent;

const input: DoctorSummaryInput = {
  checkId: 'c1',
  createdAt: new Date('2026-10-12T19:00:00Z'),
  assessedAt: new Date('2026-10-12T19:10:00Z'),
  patient: { name: 'Aarav Sharma', age: 34, sexAtBirth: 'MALE' },
  profile: { conditions: { state: 'known', items: ['Mild asthma'] }, medications: { state: 'none', items: [] }, allergies: { state: 'known', items: ['Penicillin'] } },
  ownWords: ['My throat has been sore for 3 days and I feel feverish'],
  answers: [{ question: 'Have you had a cough?', answer: 'No' }],
  additional: [],
  result,
  review: null,
  urgencyTitles: { soon: 'See a doctor within 24–48 hours', urgent: 'See a doctor today' },
  now: new Date('2026-10-12T19:30:00Z'),
};

const section = (s: ReturnType<typeof buildDoctorSummary>, id: string) => s.sections.find((x) => x.id === id)?.text ?? '';

describe('doctor summary', () => {
  it('uses only confirmed findings, the profile and Nora’s reasoning', () => {
    const s = buildDoctorSummary(input);
    expect(section(s, 'patient')).toContain('Aarav Sharma, 34 years, male');
    expect(section(s, 'reason')).toContain('“My throat has been sore');
    expect(section(s, 'symptoms')).toBe('- Sore throat\n- Highest temperature: 38.5 °C');
    expect(section(s, 'negatives')).toBe('- Cough');
    expect(section(s, 'uncertain')).toContain('pus on the tonsils');
    expect(section(s, 'history')).toContain('Conditions: Mild asthma');
    expect(section(s, 'history')).toContain('Medicines: none');
    expect(section(s, 'history')).toContain('Allergies: Penicillin');
    expect(section(s, 'history')).toContain('Relevant to this consultation: Long-term lung condition');
    expect(section(s, 'assessment')).toContain('Urgency: See a doctor within 24–48 hours');
    expect(section(s, 'assessment')).not.toContain('Bacterial');
    expect(section(s, 'explanation')).toContain('- About sore throats');
    expect(section(s, 'explanation')).toContain('not a diagnosis');
    expect(section(s, 'explanation')).toContain('cannot change the urgency');
    expect(s.sections.map((x) => x.text).join('\n')).not.toMatch(/likely|Streptococcal|Bacterial/i);
    expect(section(s, 'recommendations')).toContain('Next step: See a doctor within 24–48 hours');
    expect(section(s, 'answers')).toBe('- Have you had a cough? — No');
    expect(section(s, 'changes')).toContain('profile does not list it');
    expect(section(s, 'sources').split('\n')).toHaveLength(1);
    expect(section(s, 'notes')).toBe('');
    expect(section(s, 'disclaimer')).toMatch(/may have edited/);
  });

  it('leaves out the possible causes stored by earlier versions without changing the record', () => {
    const legacy = { ...result, explanations: [{ code: 'bacterial_pharyngitis', label: 'Bacterial throat infection', plain: '', clinical: 'Streptococcal pharyngitis', likelihood: 'more_likely', rationale: '', citations: ['E1'] }] } as ResultContent;
    const s = buildDoctorSummary({ ...input, result: legacy });
    expect(s.sections.map((x) => x.text).join('\n')).not.toMatch(/Bacterial|Streptococcal|more likely/i);
    expect(section(s, 'explanation')).toContain('earlier version of Nora');
    expect(legacy.explanations).toHaveLength(1);
  });

  it('keeps exposures apart from symptoms and quotes the patient’s own words', () => {
    const s = buildDoctorSummary({
      ...input,
      result: {
        ...result,
        findings: {
          ...result.findings,
          present: [{ key: 'fever', label: 'Fever', source: 'rules', said: 'fever since yesterday' }, { key: 'duration_days', label: 'How long', value: 1, unit: 'days', source: 'rules', said: 'fever since yesterday' }],
          exposures: [{ key: 'animal_bite', label: 'Bitten or scratched by an animal', source: 'rules', said: 'a dog bit me 5 days ago' }],
        },
      },
    });
    expect(section(s, 'symptoms')).toContain('Fever');
    expect(section(s, 'symptoms')).toContain('fever since yesterday');
    expect(section(s, 'symptoms')).not.toMatch(/bit/i);
    expect(s.sections.map((x) => x.text).join('\n')).toMatch(/a dog bit me 5 days ago/);
  });

  it('uses India time for every date, including the file name', () => {
    const s = buildDoctorSummary(input);
    expect(section(s, 'patient')).toContain('Check started: 13 October 2026, 12:30 am IST');
    expect(section(s, 'patient')).toContain('Assessed: 13 October 2026, 12:40 am IST');
    expect(section(s, 'disclaimer')).toContain('Prepared on 13 October 2026');
    expect(s.fileDate).toBe('2026-10-13');
  });

  it('includes what the patient added at the end and how this relates to an earlier check', () => {
    const s = buildDoctorSummary({
      ...input,
      additional: ['I work night shifts.'],
      result: {
        ...result,
        episode: { earlier: { checkId: 'p1', text: '3 October 2026 — sore throat.', href: '/summary/p1' }, answer: 'returned', label: 'You said your symptoms got better after your earlier check, then came back.' },
        triage: { decidedBy: 'rules', missingSafety: [{ key: 'drooling', label: 'Drooling', gap: 'unsure' }] },
      },
    });
    expect(section(s, 'notes')).toBe('I work night shifts.');
    expect(section(s, 'earlier')).toContain('got better after your earlier check, then came back');
    expect(section(s, 'assessment')).toContain('- Drooling (patient unsure)');
  });

  it('shows a clinician’s corrected urgency instead of Nora’s', () => {
    const s = buildDoctorSummary({ ...input, review: { status: 'corrected', clinician: 'Dr Rao', correctedUrgency: 'urgent', patientNote: 'Please be seen today.' } });
    expect(section(s, 'assessment')).toContain('Urgency: See a doctor today (set by a reviewing clinician)');
    expect(section(s, 'review')).toContain('Dr Rao');
  });

  it('says plainly when information was not recorded', () => {
    const s = buildDoctorSummary({ ...input, profile: null, ownWords: [], patient: { name: null, age: null, sexAtBirth: null } });
    expect(section(s, 'history')).toContain('Conditions: not recorded');
    expect(section(s, 'reason')).toContain('without a written description');
  });
});
