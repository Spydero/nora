import { demoBundle } from '../clinical/content/demo-bundle.js';
import { InvalidAnswerError, mapAnswer } from './answer-mapping.js';

const q = (id: string) => demoBundle.questions[id]!;

describe('answer mapping', () => {
  it('maps yes, no and not sure to present, absent and unknown', () => {
    expect(mapAnswer(q('q_cough'), 'yes').facts).toEqual({ cough: { state: 'PRESENT', source: 'answer' } });
    expect(mapAnswer(q('q_cough'), 'no').facts).toEqual({ cough: { state: 'ABSENT', source: 'answer' } });
    expect(mapAnswer(q('q_cough'), 'unsure').facts).toEqual({ cough: { state: 'UNKNOWN', source: 'answer' } });
  });

  it('records skips as declined, never as absent', () => {
    const red = mapAnswer(q('q_red_flags'), null);
    expect(red.label).toBe('Skipped');
    expect(Object.values(red.facts).every((f) => f.state === 'DECLINED')).toBe(true);
    expect(red.facts.chest_pain).toBeDefined();
  });

  it('refuses to skip a required question', () => {
    expect(() => mapAnswer(q('q_age'), null)).toThrow(InvalidAnswerError);
  });

  it('validates number ranges', () => {
    expect(mapAnswer(q('q_temperature'), 38.6)).toMatchObject({ facts: { temperature_c: { state: 'PRESENT', value: 38.6 } }, label: '38.6 °C' });
    expect(() => mapAnswer(q('q_temperature'), 3.6)).toThrow(InvalidAnswerError);
  });

  it('marks unticked red flags absent and rejects mixing "none" with a flag', () => {
    const none = mapAnswer(q('q_red_flags'), ['none']);
    expect(none.facts.chest_pain).toEqual({ state: 'ABSENT', source: 'answer' });
    const chest = mapAnswer(q('q_red_flags'), ['chest_pain']);
    expect(chest.facts.chest_pain?.state).toBe('PRESENT');
    expect(chest.facts.stroke_signs?.state).toBe('ABSENT');
    expect(() => mapAnswer(q('q_red_flags'), ['none', 'chest_pain'])).toThrow(InvalidAnswerError);
  });

  it('leaves unticked concerns unasked on the main-concern question', () => {
    const main = mapAnswer(q('q_main_concern'), ['sore_throat']);
    expect(main.facts.sore_throat?.state).toBe('PRESENT');
    expect(Object.values(main.facts).filter((f) => f.state === 'ABSENT')).toHaveLength(0);
  });
});
