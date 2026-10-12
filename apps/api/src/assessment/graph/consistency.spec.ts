import { demoBundle } from '../../clinical/content/demo-bundle.js';
import type { FactMap } from '../../clinical/rules-engine.js';
import { answerFacts, answerIssues, urgencyIssues } from './consistency.js';

const facts: FactMap = {
  sore_throat: { state: 'PRESENT', source: 'answer' },
  fever: { state: 'PRESENT', source: 'answer' },
  temperature_c: { state: 'PRESENT', value: 38.4, source: 'answer' },
  duration_days: { state: 'PRESENT', value: 3, source: 'answer' },
  cough: { state: 'ABSENT', source: 'answer' },
  recurrent: { state: 'PRESENT', source: 'memory' },
};
const answers = answerFacts(demoBundle, facts);

describe('answer consistency', () => {
  it('accepts a faithful summary', () => {
    expect(
      answerIssues(['You have had a sore throat and a fever of 38.4 °C for 3 days, with no cough.', 'A fever lasting 5 days or more should be checked.'], answers),
    ).toEqual([]);
  });

  it('catches a denied symptom the patient said they have', () => {
    expect(answerIssues(['You don’t have a fever, so this looks mild.'], answers).join(' ')).toMatch(/you said you do/);
    expect(answerIssues(['There are no signs of fever.'], answers).join(' ')).toMatch(/"Fever"/);
  });

  it('catches a symptom claimed after the patient said no', () => {
    expect(answerIssues(['You have a sore throat and a cough.'], answers).join(' ')).toMatch(/"Cough", but you said you don't/);
    expect(answerIssues(['If you have a cough, mention it.'], answers)).toEqual([]);
  });

  it('catches restated numbers that differ from the answers', () => {
    expect(answerIssues(['Your temperature reached 39.4 °C.'], answers).join(' ')).toMatch(/38.4/);
    expect(answerIssues(['You have had this for 5 days.'], answers).join(' ')).toMatch(/3 days/);
    expect(answerIssues(['A temperature of 39.5 °C or higher needs care today.'], answers)).toEqual([]);
  });

  it('ignores facts that came from memory rather than the patient', () => {
    expect(answers.present.map((p) => p.label)).not.toContain('A similar check in the last 30 days');
  });
});

describe('urgency consistency', () => {
  const reassuring = 'This usually settles on its own and can be managed at home.';
  it('allows reassurance only when the rules allow self-care', () => {
    expect(urgencyIssues([reassuring], 'self_care')).toEqual([]);
    expect(urgencyIssues([reassuring], 'routine')).toEqual([]);
    expect(urgencyIssues([reassuring], 'soon')).toHaveLength(1);
  });

  it('rejects weaker next steps than the level requires', () => {
    expect(urgencyIssues(['Book a routine appointment if it does not improve.'], 'soon')).toHaveLength(1);
    expect(urgencyIssues(['See a doctor within 24–48 hours.'], 'soon')).toEqual([]);
    expect(urgencyIssues(['See a doctor within 24–48 hours.'], 'urgent')).toHaveLength(1);
  });
});
