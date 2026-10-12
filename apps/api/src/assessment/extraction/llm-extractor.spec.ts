import { demoBundle } from '../../clinical/content/demo-bundle.js';
import { mergeObservations, validateObservations } from './llm-extractor.js';
import { extractWithRules } from './rule-extractor.js';

type Raw = Parameters<typeof validateObservations>[2][number];

const raw = (factKey: string, value: number | null, quote: string): Raw => ({
  factKey,
  state: 'PRESENT',
  value,
  quote,
  assertion: 'affirmed',
});

describe('model observation validation', () => {
  const message = "My throat has been sore for 3 days and I've had a fever around 38.5, about 101.3 F last night";
  const kept = (o: Raw) => validateObservations(demoBundle, message, [o]).map((x) => x.value);

  it('keeps numbers the patient actually wrote', () => {
    expect(kept(raw('duration_days', 3, 'for 3 days'))).toEqual([3]);
    expect(kept(raw('temperature_c', 38.5, 'around 38.5'))).toEqual([38.5]);
  });

  it('accepts a Fahrenheit reading converted to Celsius', () => {
    expect(kept(raw('temperature_c', 38.5, 'about 101.3 F'))).toEqual([38.5]);
  });

  it('drops numbers that do not match the quote or fall outside the question range', () => {
    expect(kept(raw('temperature_c', 3.6, 'around 38.5'))).toEqual([]);
    expect(kept(raw('duration_days', 30, 'for 3 days'))).toEqual([]);
    expect(validateObservations(demoBundle, 'pain is 15 out of 10', [raw('pain_score', 15, 'pain is 15')])).toEqual([]);
  });

  it('prefers the deterministic parse when both extractors read a number', () => {
    const text = 'Fever of 101 F since yesterday';
    const rules = extractWithRules(demoBundle, text);
    const llm = validateObservations(demoBundle, text, [raw('temperature_c', 38.4, 'Fever of 101 F')]);
    const merged = mergeObservations(demoBundle, rules, llm);
    expect(merged.find((o) => o.factKey === 'temperature_c')).toMatchObject({ value: 38.3, source: 'rules' });
  });
});
