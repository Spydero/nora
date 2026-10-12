import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

export interface ModelSet {
  /** Tool-calling reasoning model for research and drafting. */
  chat: BaseChatModel;
  /** Cheaper model for structured extraction. */
  fast: BaseChatModel;
  chatName: string;
  fastName: string;
}

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  fastModel: string;
  embeddingModel: string;
  timeoutMs: number;
}

const headers = { 'HTTP-Referer': 'https://nora.local', 'X-Title': 'Nora' };

type ClientOptions = { defaultHeaders?: Record<string, string>; fetch?: typeof fetch };

function chat(cfg: Omit<OpenRouterConfig, 'embeddingModel'>, model: string, client: ClientOptions = {}): ChatOpenAI {
  return new ChatOpenAI({
    model,
    apiKey: cfg.apiKey,
    temperature: 0,
    timeout: cfg.timeoutMs,
    maxRetries: 1,
    configuration: { baseURL: cfg.baseUrl, ...client },
  });
}

/** Gemini's OpenAI-compatible endpoint rejects these keywords with a bare 400; Zod still validates the parsed output. */
const GEMINI_UNSUPPORTED = new Set(['maxItems', 'minItems', 'maxLength', 'minLength', 'pattern']);

export function geminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(geminiSchema);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([k, v]) => !(GEMINI_UNSUPPORTED.has(k) && typeof v !== 'object'))
      .map(([k, v]) => [k, geminiSchema(v)]),
  );
}

type Tool = { type?: string; function?: { parameters?: unknown } };
type ToolCall = { id?: string; function?: { name?: string; arguments?: string }; extra_content?: { google?: { thought_signature?: string } } };
type ChatBody = { tools?: Tool[]; messages?: { role: string; tool_calls?: ToolCall[] }[] };

/**
 * Gemini thinking models sign each function call and reject the next turn unless the signature
 * comes back with it. LangChain's OpenAI client drops the field, so it is carried here.
 * Calls with no remembered signature use the bypass value Google documents for replayed history.
 */
const SIGNATURE_BYPASS = 'skip_thought_signature_validator';
const MAX_SIGNATURES = 2000;
const signatures = new Map<string, string>();

function callKey(call: ToolCall): string {
  let args = call.function?.arguments ?? '';
  try {
    args = JSON.stringify(JSON.parse(args));
  } catch {
    // keep the raw string
  }
  return `${call.id}\u0000${call.function?.name}\u0000${args}`;
}

export function rememberSignatures(response: { choices?: { message?: { tool_calls?: ToolCall[] } }[] }) {
  for (const call of response.choices?.flatMap((c) => c.message?.tool_calls ?? []) ?? []) {
    const signature = call.extra_content?.google?.thought_signature;
    if (!signature) continue;
    signatures.set(callKey(call), signature);
    if (signatures.size > MAX_SIGNATURES) signatures.delete(signatures.keys().next().value!);
  }
}

export function prepareGeminiBody(body: ChatBody): ChatBody {
  return {
    ...body,
    ...(body.tools ? { tools: body.tools.map((t) => (t.function ? { ...t, function: { ...t.function, parameters: geminiSchema(t.function.parameters) } } : t)) } : {}),
    ...(body.messages
      ? {
          messages: body.messages.map((m) =>
            m.role === 'assistant' && m.tool_calls
              ? {
                  ...m,
                  tool_calls: m.tool_calls.map((c) =>
                    c.extra_content?.google?.thought_signature ? c : { ...c, extra_content: { google: { thought_signature: signatures.get(callKey(c)) ?? SIGNATURE_BYPASS } } },
                  ),
                }
              : m,
          ),
        }
      : {}),
  };
}

const geminiFetch: typeof fetch = async (input, init) => {
  if (typeof init?.body !== 'string') return fetch(input, init);
  const res = await fetch(input, { ...init, body: JSON.stringify(prepareGeminiBody(JSON.parse(init.body) as ChatBody)) });
  if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
    rememberSignatures((await res.clone().json()) as Parameters<typeof rememberSignatures>[0]);
  }
  return res;
};

export function createOpenRouterModels(cfg: OpenRouterConfig): ModelSet {
  const client = { defaultHeaders: headers };
  return { chat: chat(cfg, cfg.model, client), fast: chat(cfg, cfg.fastModel, client), chatName: cfg.model, fastName: cfg.fastModel };
}

/** Gemini through Google's OpenAI-compatible endpoint, so the graph's tool calling is unchanged. */
export function createGeminiModels(cfg: Omit<OpenRouterConfig, 'embeddingModel'>): ModelSet {
  const client = { fetch: geminiFetch };
  return { chat: chat(cfg, cfg.model, client), fast: chat(cfg, cfg.fastModel, client), chatName: cfg.model, fastName: cfg.fastModel };
}

export function createOpenRouterEmbeddings(cfg: OpenRouterConfig): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    model: cfg.embeddingModel,
    apiKey: cfg.apiKey,
    timeout: cfg.timeoutMs,
    maxRetries: 1,
    configuration: { baseURL: cfg.baseUrl, defaultHeaders: headers },
  });
}
