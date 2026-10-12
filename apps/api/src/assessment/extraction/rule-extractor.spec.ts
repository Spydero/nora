import { demoBundle } from '../../clinical/content/demo-bundle.js';
import { extractWithRules } from './rule-extractor.js';

const facts = (text: string) =>
  Object.fromEntries(extractWithRules(demoBundle, text).map((o) => [o.factKey, o.value ?? o.state]));

describe('rule-based extractor', () => {
  it('extracts affirmed symptoms, duration and temperature', () => {
    expect(facts('I have had a sore throat for 3 days and a fever of 101 F')).toMatchObject({
      sore_throat: 'PRESENT',
      fever: 'PRESENT',
      duration_days: 3,
      temperature_c: 38.3,
    });
  });

  it('honours negation within the clause only', () => {
    expect(facts('No fever but my throat hurts')).toMatchObject({ fever: 'ABSENT', sore_throat: 'PRESENT' });
    expect(facts("I don't have a cough")).toMatchObject({ cough: 'ABSENT' });
  });

  it('never marks historical, hypothetical or family mentions as present', () => {
    expect(facts('I had chest pain last year')).not.toHaveProperty('chest_pain');
    expect(facts('What if I get chest pain?')).not.toHaveProperty('chest_pain');
    expect(facts('My father has chest pain')).not.toHaveProperty('chest_pain');
  });

  it('catches emergency phrases', () => {
    expect(facts('I suddenly have the worst headache of my life and slurred speech')).toMatchObject({
      headache: 'PRESENT',
      stroke_signs: 'PRESENT',
    });
    expect(facts('sometimes I want to end my life')).toMatchObject({ self_harm_thoughts: 'PRESENT' });
  });

  it('parses age, weeks and pain score', () => {
    expect(facts("I'm 42 and my back hurts, pain 7/10 for 2 weeks")).toMatchObject({
      age: 42,
      back_pain: 'PRESENT',
      pain_score: 7,
      duration_days: 14,
    });
  });

  it('derives fever from a measured temperature', () => {
    expect(facts('temperature was 39.8 degrees C')).toMatchObject({ temperature_c: 39.8, fever: 'PRESENT' });
    expect(facts('my temp is 36.9')).toMatchObject({ temperature_c: 36.9, fever: 'ABSENT' });
  });

  it('keeps quotes as exact substrings of the original message', () => {
    const msg = 'Burning When I Pee since yesterday';
    for (const o of extractWithRules(demoBundle, msg)) expect(msg).toContain(o.quote);
  });
});
