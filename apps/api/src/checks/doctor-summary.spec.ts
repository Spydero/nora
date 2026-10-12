import type { ResultContent } from '../assessment/result.types.js';
import { buildDoctorSummary, type DoctorSummaryInput } from './doctor-summary.js';

const result = {
  schemaVersion: '1',
  status: 'COMPLETED',
  urgency: { level: 'soon', title: 'See a doctor within 24–48 hours', text: '', reasons: [{ ruleId: 'r_strep_features', message: 'Fever with swollen glands and no cough can suggest a bacterial throat infection.', citations: ['E1'] }] },
  summary: 'You have a sore throat with fever.',
  concerns: [{ code: 'sore_throat', label: 'Sore throat' }],
  findings: {
    present: [{ key: 'sore_throat', label: 'Sore throat', source: 'llm' }, { key: 'temperature_c', label: 'Highest temperature', value: 38.5, unit: '°C', source: 'answer' }],
    absent: [{ key: 'cough', label: 'Cough', source: 'answer' }],
    unknown: [{ key: 'tonsil_pus', label: 'White patches or pus on the tonsils', source: 'answer' }],
    history: { present: [{ key: 'chronic_lung_disease', label: 'Long-term lung condition', source: 'profile' }], absent: [], unknown: [] },
  },
  explanations: [{ code: 'bacterial_pharyngitis', label: 'Bacterial throat infection', plain: '', clinical: 'Streptococcal pharyngitis', likelihood: 'more_likely', rationale: '', citations: ['E1'] }],
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
  createdAt: new Date('2026-10-13T06:00:00Z'),
  patient: { name: 'Aarav Sharma', age: 34, sexAtBirth: 'MALE' },
  profile: { conditions: { state: 'known', items: ['Mild asthma'] }, medications: { state: 'none', items: [] }, allergies: { state: 'known', items: ['Penicillin'] } },
  ownWords: ['My throat has been sore for 3 days and I feel feverish'],
  result,
  review: null,
  urgencyTitles: { soon: 'See a doctor within 24–48 hours', urgent: 'See a doctor today' },
  now: new Date('2026-10-13T07:00:00Z'),
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
    expect(section(s, 'assessment')).toContain('Bacterial throat infection (Streptococcal pharyngitis): more likely');
    expect(section(s, 'assessment')).toContain('not a diagnosis');
    expect(section(s, 'changes')).toContain('profile does not list it');
    expect(section(s, 'sources').split('\n')).toHaveLength(1);
    expect(section(s, 'notes')).toBe('');
    expect(section(s, 'disclaimer')).toMatch(/may have edited/);
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
