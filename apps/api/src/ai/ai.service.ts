import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { type DecisionPort, OpenRouterDecisionClient } from './decisions.js';
import { createOpenRouterModels, type ModelSet } from './models.js';

/** Shared model clients. Without an API key Nora runs in labelled template mode. */
@Injectable()
export class AiService {
  readonly models: ModelSet | null;
  readonly decisions: DecisionPort | null;
  readonly maxResearchRounds: number;

  constructor(config: ConfigService<Env, true>) {
    const apiKey = config.get('OPENROUTER_API_KEY', { infer: true });
    const baseUrl = config.get('OPENROUTER_BASE_URL', { infer: true });
    const timeoutMs = config.get('AI_TIMEOUT_MS', { infer: true });
    this.maxResearchRounds = config.get('AI_MAX_RESEARCH_ROUNDS', { infer: true });
    if (!apiKey) {
      new Logger(AiService.name).warn('OPENROUTER_API_KEY is not set; assessments use approved templates only');
      this.models = null;
      this.decisions = null;
      return;
    }
    this.models = createOpenRouterModels({
      apiKey,
      baseUrl,
      model: config.get('OPENROUTER_MODEL', { infer: true }),
      fastModel: config.get('OPENROUTER_FAST_MODEL', { infer: true }),
      embeddingModel: config.get('OPENROUTER_EMBEDDING_MODEL', { infer: true }),
      timeoutMs,
    });
    this.decisions = new OpenRouterDecisionClient(config.get('OPENROUTER_DECISION_MODEL', { infer: true }), apiKey, baseUrl, timeoutMs);
  }
}
