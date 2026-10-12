import { z } from 'zod';

export const URGENCY_LEVELS = ['self_care', 'routine', 'soon', 'urgent', 'emergency'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export function urgencyRank(level: UrgencyLevel): number {
  return URGENCY_LEVELS.indexOf(level);
}

export function maxUrgency(a: UrgencyLevel, b: UrgencyLevel): UrgencyLevel {
  return urgencyRank(a) >= urgencyRank(b) ? a : b;
}

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; is: 'present' | 'absent' | 'unknown' | 'known' }
  | { fact: string; gte?: number; lte?: number; gt?: number; lt?: number; eq?: string | number };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1) }),
    z.object({ any: z.array(conditionSchema).min(1) }),
    z.object({ not: conditionSchema }),
    z.object({ fact: z.string(), is: z.enum(['present', 'absent', 'unknown', 'known']) }),
    z
      .object({
        fact: z.string(),
        gte: z.number().optional(),
        lte: z.number().optional(),
        gt: z.number().optional(),
        lt: z.number().optional(),
        eq: z.union([z.string(), z.number()]).optional(),
      })
      .refine((c) => [c.gte, c.lte, c.gt, c.lt, c.eq].some((v) => v !== undefined), 'Comparison needs an operator'),
  ]),
);

const factSchema = z.object({
  label: z.string(),
  type: z.enum(['boolean', 'number']),
  unit: z.string().optional(),
  synonyms: z.array(z.string()).default([]),
  critical: z.boolean().default(false),
});

const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
  /** For multi-select red-flag style questions: each option maps to its own fact. */
  factKey: z.string().optional(),
  exclusive: z.boolean().default(false),
});

const questionSchema = z.object({
  text: z.string(),
  why: z.string().optional(),
  type: z.enum(['yes_no', 'multi', 'number']),
  factKey: z.string().optional(),
  options: z.array(optionSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().optional(),
  allowSkip: z.boolean().default(true),
  askIf: conditionSchema.optional(),
  /** Multi-select: whether options left unticked record ABSENT or stay unasked. */
  unselected: z.enum(['absent', 'unasked']).default('absent'),
});

const explanationSchema = z.object({
  code: z.string(),
  label: z.string(),
  plain: z.string(),
  clinical: z.string(),
  supportingFacts: z.array(z.string()).default([]),
  againstFacts: z.array(z.string()).default([]),
  sourceKeys: z.array(z.string()).min(1),
});

const concernSchema = z.object({
  code: z.string(),
  label: z.string(),
  triggers: z.array(z.string()).min(1),
  /** General presentations (fever, a cold) that only apply when no more specific concern matches. */
  onlyAlone: z.boolean().default(false),
  specialty: z.string(),
  defaultLevel: z.enum(URGENCY_LEVELS),
  questions: z.array(z.string()),
  requiredFacts: z.array(z.string()),
  explanations: z.array(explanationSchema).min(1),
  careItems: z.array(z.string()),
  sourceKeys: z.array(z.string()).min(1),
});

const ruleSchema = z.object({
  id: z.string(),
  level: z.enum(URGENCY_LEVELS),
  when: conditionSchema,
  message: z.string(),
  concerns: z.array(z.string()).optional(),
  careItems: z.array(z.string()).default([]),
  sourceKey: z.string(),
});

const exclusionSchema = z.object({
  id: z.string(),
  when: conditionSchema,
  message: z.string(),
});

const careItemSchema = z.object({
  kind: z.enum(['urgent_action', 'self_care', 'monitoring', 'handoff']),
  text: z.string(),
  timeframe: z.string().optional(),
  sourceKey: z.string(),
  /**
   * For "get help if…" items: the conditions the text describes and the level
   * they call for. If one already holds, the warning has happened, so the
   * engine raises urgency instead of telling the patient to watch for it.
   */
  escalate: z.array(z.object({ level: z.enum(URGENCY_LEVELS), when: conditionSchema })).default([]),
});

const sentinelSchema = z.object({
  id: z.string(),
  description: z.string(),
  concern: z.string().optional(),
  age: z.number().default(35),
  facts: z.record(z.string(), z.union([z.enum(['PRESENT', 'ABSENT', 'UNKNOWN']), z.number()])),
  expectedLevel: z.enum(URGENCY_LEVELS),
  critical: z.boolean().default(false),
});

export const bundleContentSchema = z
  .object({
    meta: z.object({
      name: z.string(),
      jurisdiction: z.string(),
      disclaimer: z.string(),
      ageMin: z.number().int(),
      maxTurns: z.number().int().positive(),
      /** A finished check for the same concern within this many days sets the `recurrent` fact. */
      recurrenceDays: z.number().int().positive().default(30),
    }),
    facts: z.record(z.string(), factSchema),
    concerns: z.array(concernSchema).min(1),
    questions: z.record(z.string(), questionSchema),
    screeningQuestions: z.array(z.string()),
    urgencyRules: z.array(ruleSchema),
    exclusions: z.array(exclusionSchema),
    careItems: z.record(z.string(), careItemSchema),
    urgencyActions: z.record(z.enum(URGENCY_LEVELS), z.object({ title: z.string(), text: z.string(), careItems: z.array(z.string()) })),
    sentinels: z.array(sentinelSchema),
  })
  .superRefine((content, ctx) => {
    const facts = new Set(Object.keys(content.facts));
    const questions = new Set(Object.keys(content.questions));
    const care = new Set(Object.keys(content.careItems));
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });

    const walk = (c: Condition, where: string) => {
      if ('all' in c) c.all.forEach((x) => walk(x, where));
      else if ('any' in c) c.any.forEach((x) => walk(x, where));
      else if ('not' in c) walk(c.not, where);
      else if (!facts.has(c.fact)) issue(`${where} references unknown fact "${c.fact}"`);
    };

    for (const [id, q] of Object.entries(content.questions)) {
      if (q.factKey && !facts.has(q.factKey)) issue(`question ${id} references unknown fact ${q.factKey}`);
      q.options?.forEach((o) => o.factKey && !facts.has(o.factKey) && issue(`question ${id} option ${o.value} unknown fact`));
      if (q.askIf) walk(q.askIf, `question ${id}`);
    }
    for (const id of content.screeningQuestions) if (!questions.has(id)) issue(`screening question ${id} missing`);
    const explanationCodes = new Set<string>();
    for (const concern of content.concerns) {
      for (const e of concern.explanations) {
        if (explanationCodes.has(e.code)) issue(`explanation code ${e.code} is used by more than one concern`);
        explanationCodes.add(e.code);
      }
      concern.triggers.forEach((f) => !facts.has(f) && issue(`concern ${concern.code} trigger ${f} unknown`));
      concern.questions.forEach((q) => !questions.has(q) && issue(`concern ${concern.code} question ${q} missing`));
      concern.requiredFacts.forEach((f) => !facts.has(f) && issue(`concern ${concern.code} required fact ${f} unknown`));
      concern.careItems.forEach((i) => !care.has(i) && issue(`concern ${concern.code} care item ${i} missing`));
    }
    for (const rule of content.urgencyRules) {
      walk(rule.when, `rule ${rule.id}`);
      rule.careItems.forEach((i) => !care.has(i) && issue(`rule ${rule.id} care item ${i} missing`));
    }
    for (const [id, item] of Object.entries(content.careItems)) item.escalate.forEach((e) => walk(e.when, `care item ${id}`));
    for (const exclusion of content.exclusions) walk(exclusion.when, `exclusion ${exclusion.id}`);
    for (const action of Object.values(content.urgencyActions)) {
      action.careItems.forEach((i) => !care.has(i) && issue(`urgency action care item ${i} missing`));
    }
  });

export type BundleContent = z.infer<typeof bundleContentSchema>;
export type BundleInput = z.input<typeof bundleContentSchema>;
export type ConcernDef = BundleContent['concerns'][number];
export type QuestionDef = BundleContent['questions'][string];
export type UrgencyRule = BundleContent['urgencyRules'][number];
