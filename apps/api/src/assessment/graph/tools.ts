import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { KnowledgePort } from '../../knowledge/knowledge.port.js';
import type { EvidenceRegistry } from './evidence-registry.js';

export const RESEARCH_TOOL_NAMES = ['search_knowledge', 'get_case_summary', 'get_source'] as const;

interface ToolDeps {
  knowledge: KnowledgePort;
  registry: EvidenceRegistry;
  concernCodes: () => string[];
  allowedSourceKeys: () => string[];
  caseSummary: () => object;
  onSearch?: (query: string) => void | Promise<void>;
}

/**
 * Read-only research tools. They can only read approved knowledge and the
 * case as the rules engine sees it; nothing here can mutate a case.
 */
export function createResearchTools(deps: ToolDeps) {
  const cite = (chunks: Awaited<ReturnType<KnowledgePort['search']>>) =>
    chunks.map((c) => {
      const ref = deps.registry.add(c);
      return { citationId: ref.citationId, source: c.title, heading: c.heading, text: c.text };
    });

  const searchKnowledge = tool(
    async ({ query, concern }) => {
      await deps.onSearch?.(query);
      const codes = concern ? [concern] : deps.concernCodes();
      const hits = await deps.knowledge.search(query, { concernCodes: codes, limit: 4 });
      return JSON.stringify(hits.length ? cite(hits) : { message: 'No approved passages matched. Try a different query.' });
    },
    {
      name: 'search_knowledge',
      description: 'Search the approved clinical knowledge library. Returns passages with citation IDs.',
      schema: z.object({
        query: z.string().min(2).max(200).describe('Focused search query, e.g. "bacterial throat infection signs"'),
        concern: z.string().optional().describe('Optional concern code to restrict the search'),
      }),
    },
  );

  const getCaseSummary = tool(async () => JSON.stringify(deps.caseSummary()), {
    name: 'get_case_summary',
    description: 'Get the structured case: active concerns, present/absent/unknown facts, and the rule-based urgency (final).',
    schema: z.object({}),
  });

  const getSource = tool(
    async ({ sourceKey }) => {
      if (!deps.allowedSourceKeys().includes(sourceKey)) {
        return JSON.stringify({ error: `Unknown source key. Allowed: ${deps.allowedSourceKeys().join(', ')}` });
      }
      return JSON.stringify(cite(await deps.knowledge.bySourceKeys([sourceKey], 10)));
    },
    {
      name: 'get_source',
      description: 'Read all passages of one approved source by source key.',
      schema: z.object({ sourceKey: z.string().describe('Source key such as "src_sore_throat"') }),
    },
  );

  return [searchKnowledge, getCaseSummary, getSource];
}
