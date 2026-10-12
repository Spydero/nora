import type { EvidenceChunk } from '../../knowledge/knowledge.port.js';
import type { EvidenceRef } from '../result.types.js';

const EXCERPT_CHARS = 600;

/** Assigns stable citation IDs (E1, E2, …) to every passage retrieved during one run. */
export class EvidenceRegistry {
  private readonly byChunk = new Map<string, EvidenceRef>();

  constructor(initial: EvidenceRef[] = []) {
    for (const ref of initial) this.byChunk.set(ref.chunkId, ref);
  }

  add(chunk: EvidenceChunk): EvidenceRef {
    const existing = this.byChunk.get(chunk.chunkId);
    if (existing) return existing;
    const ref: EvidenceRef = {
      citationId: `E${this.byChunk.size + 1}`,
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      sourceKey: chunk.sourceKey,
      version: chunk.version,
      title: chunk.title,
      publisher: chunk.publisher,
      heading: chunk.heading,
      excerpt: chunk.text.slice(0, EXCERPT_CHARS),
      url: chunk.url,
    };
    this.byChunk.set(chunk.chunkId, ref);
    return ref;
  }

  has(citationId: string): boolean {
    return this.list().some((r) => r.citationId === citationId);
  }

  firstForSource(sourceKey: string): string | undefined {
    return this.list().find((r) => r.sourceKey === sourceKey)?.citationId;
  }

  list(): EvidenceRef[] {
    return [...this.byChunk.values()];
  }
}
