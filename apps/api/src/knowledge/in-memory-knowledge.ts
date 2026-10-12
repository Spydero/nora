import type { KnowledgeSeed } from '../clinical/content/knowledge.js';
import type { EvidenceChunk, KnowledgePort } from './knowledge.port.js';

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

/** Keyword-scored knowledge store used by orchestration tests. */
export class InMemoryKnowledge implements KnowledgePort {
  readonly chunks: (EvidenceChunk & { concernCodes: string[] })[];
  readonly searches: string[] = [];

  constructor(seed: KnowledgeSeed[]) {
    this.chunks = seed.flatMap((doc) =>
      doc.chunks.map((c, i) => ({
        chunkId: `${doc.sourceKey}#${i}`,
        documentId: doc.sourceKey,
        sourceKey: doc.sourceKey,
        version: 1,
        title: doc.title,
        publisher: doc.publisher,
        heading: c.heading,
        text: c.text,
        url: doc.url,
        concernCodes: doc.concernCodes,
      })),
    );
  }

  async search(query: string, opts: { concernCodes?: string[]; limit?: number } = {}): Promise<EvidenceChunk[]> {
    this.searches.push(query);
    const q = tokens(query);
    return this.chunks
      .filter((c) => !opts.concernCodes?.length || c.concernCodes.some((code) => opts.concernCodes!.includes(code)))
      .map((c) => ({ c, score: [...tokens(`${c.heading} ${c.text}`)].filter((t) => q.has(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit ?? 4)
      .map((x) => x.c);
  }

  async bySourceKeys(sourceKeys: string[], perSource = 2): Promise<EvidenceChunk[]> {
    return sourceKeys.flatMap((key) => this.chunks.filter((c) => c.sourceKey === key).slice(0, perSource));
  }
}
