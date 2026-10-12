export type DecisionQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type DecisionAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number };

export interface DecisionResult {
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage: { inputTokens: number; outputTokens: number };
}

/** Calibrated classifier: answers fixed-option questions about a structured state. */
export interface DecisionPort {
  readonly name: string;
  decide(state: unknown, questions: Record<string, DecisionQuestion>): Promise<DecisionResult>;
}

export class OpenRouterDecisionClient implements DecisionPort {
  constructor(
    readonly name: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async decide(state: unknown, questions: Record<string, DecisionQuestion>): Promise<DecisionResult> {
    const origin = new URL(this.baseUrl).origin;
    const res = await fetch(`${origin}/api/alpha/decisions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nora.local',
        'X-Title': 'Nora',
      },
      body: JSON.stringify({ model: this.name, state, questions }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as {
      model?: string;
      answers?: Record<string, DecisionAnswer>;
      usage?: { input_tokens?: number; output_tokens?: number };
      error?: { message?: string };
    };
    if (!res.ok || !body.answers) {
      throw new Error(`Decision model ${this.name} failed (${res.status}): ${body.error?.message ?? 'no answers'}`);
    }
    return {
      model: body.model ?? this.name,
      answers: body.answers,
      usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 },
    };
  }
}

/** Replays queued decision answers for orchestration tests. */
export class ScriptedDecisions implements DecisionPort {
  readonly name = 'scripted-decisions';
  readonly calls: { state: unknown; questions: Record<string, DecisionQuestion> }[] = [];

  constructor(private readonly queue: (Record<string, DecisionAnswer> | Error)[] = []) {}

  async decide(state: unknown, questions: Record<string, DecisionQuestion>): Promise<DecisionResult> {
    this.calls.push({ state, questions });
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('ScriptedDecisions: no answers queued');
    return { model: this.name, answers: next, usage: { inputTokens: 50, outputTokens: 3 } };
  }
}
