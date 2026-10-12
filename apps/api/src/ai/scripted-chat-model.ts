import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { RunnableLambda } from '@langchain/core/runnables';

type Scripted = AIMessage | Error;
type ScriptedStructured = Record<string, unknown> | Error;

interface ZodLike {
  parse(value: unknown): unknown;
}

const usage = { input_tokens: 100, output_tokens: 50, total_tokens: 150 };

/**
 * Deterministic chat model for orchestration tests. Replays queued AI
 * messages (including tool calls) and structured outputs, and records every
 * call so tests can assert on prompts, bound tools and routing.
 */
export class ScriptedChatModel extends BaseChatModel {
  readonly calls: BaseMessage[][] = [];
  readonly structuredCalls: { name: string | undefined; input: unknown }[] = [];
  boundTools: string[] = [];

  constructor(
    private readonly replies: Scripted[] = [],
    private readonly structured: ScriptedStructured[] = [],
  ) {
    super({});
  }

  _llmType(): string {
    return 'scripted';
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls.push(messages);
    const next = this.replies.shift();
    if (next instanceof Error) throw next;
    const message = next ?? new AIMessage({ content: 'done' });
    if (!message.usage_metadata) message.usage_metadata = usage;
    return { generations: [{ text: typeof message.content === 'string' ? message.content : '', message }] };
  }

  override bindTools(tools: { name?: string }[]): this {
    this.boundTools = tools.map((t) => t.name ?? 'unknown');
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override withStructuredOutput(schema: any, config?: any): any {
    return RunnableLambda.from(async (input: unknown) => {
      this.structuredCalls.push({ name: config?.name, input });
      const next = this.structured.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error(`ScriptedChatModel: no structured output queued for ${config?.name ?? 'call'}`);
      const parsed = typeof (schema as ZodLike)?.parse === 'function' ? (schema as ZodLike).parse(next) : next;
      if (!config?.includeRaw) return parsed;
      return { raw: new AIMessage({ content: '', usage_metadata: usage }), parsed };
    });
  }

  get pendingReplies(): number {
    return this.replies.length;
  }

  get pendingStructured(): number {
    return this.structured.length;
  }
}
