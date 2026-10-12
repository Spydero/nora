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

function chat(cfg: OpenRouterConfig, model: string): ChatOpenAI {
  return new ChatOpenAI({
    model,
    apiKey: cfg.apiKey,
    temperature: 0,
    timeout: cfg.timeoutMs,
    maxRetries: 1,
    configuration: { baseURL: cfg.baseUrl, defaultHeaders: headers },
  });
}

export function createOpenRouterModels(cfg: OpenRouterConfig): ModelSet {
  return { chat: chat(cfg, cfg.model), fast: chat(cfg, cfg.fastModel), chatName: cfg.model, fastName: cfg.fastModel };
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
