import type { QuestionDef } from '../clinical/bundle.schema.js';
import type { FactMap } from '../clinical/rules-engine.js';

/** `null` means the patient skipped the question. */
export type AnswerValue = 'yes' | 'no' | 'unsure' | number | string[] | null;

export class InvalidAnswerError extends Error {}

export interface MappedAnswer {
  facts: FactMap;
  /** Patient-facing echo of what was answered. */
  label: string;
}

const YES_NO = { yes: ['PRESENT', 'Yes'], no: ['ABSENT', 'No'], unsure: ['UNKNOWN', 'Not sure'] } as const;

/**
 * Converts an answer to case facts. Skipping records DECLINED, which the rules
 * engine never treats as present or absent, so a skip cannot lower urgency.
 */
export function mapAnswer(q: QuestionDef, value: AnswerValue): MappedAnswer {
  if (value === null) {
    if (!q.allowSkip) throw new InvalidAnswerError('This question needs an answer.');
    const keys = q.type === 'multi' ? (q.options ?? []).flatMap((o) => (o.factKey ? [o.factKey] : [])) : q.factKey ? [q.factKey] : [];
    return { facts: Object.fromEntries(keys.map((k) => [k, { state: 'DECLINED' as const, source: 'answer' }])), label: 'Skipped' };
  }

  switch (q.type) {
    case 'yes_no': {
      if (typeof value !== 'string' || !(value in YES_NO) || !q.factKey) throw new InvalidAnswerError('Choose yes, no or not sure.');
      const [state, label] = YES_NO[value as keyof typeof YES_NO];
      return { facts: { [q.factKey]: { state, source: 'answer' } }, label };
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value) || !q.factKey) throw new InvalidAnswerError('Enter a number.');
      if ((q.min !== undefined && value < q.min) || (q.max !== undefined && value > q.max)) {
        throw new InvalidAnswerError(`Enter a number between ${q.min ?? '-∞'} and ${q.max ?? '∞'}.`);
      }
      return { facts: { [q.factKey]: { state: 'PRESENT', value, source: 'answer' } }, label: `${value}${q.unit ? ` ${q.unit}` : ''}` };
    }
    case 'multi': {
      const options = q.options ?? [];
      if (!Array.isArray(value) || value.length === 0) throw new InvalidAnswerError('Choose at least one option.');
      const chosen = options.filter((o) => value.includes(o.value));
      if (chosen.length !== new Set(value).size) throw new InvalidAnswerError('Choose from the options shown.');
      const exclusive = chosen.find((o) => o.exclusive);
      if (exclusive && chosen.length > 1) throw new InvalidAnswerError(`"${exclusive.label}" cannot be combined with other options.`);

      const facts: FactMap = {};
      for (const o of options) {
        if (!o.factKey) continue;
        if (chosen.includes(o)) facts[o.factKey] = { state: 'PRESENT', source: 'answer' };
        else if (q.unselected !== 'unasked') facts[o.factKey] = { state: 'ABSENT', source: 'answer' };
      }
      return { facts, label: chosen.map((o) => o.label).join(', ') };
    }
  }
}
