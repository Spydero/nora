import type { PrismaService } from '../prisma/prisma.service.js';
import type { EvidenceChunk, KnowledgePort } from './knowledge.port.js';

interface ChunkRow {
  chunk_id: string;
  document_id: string;
  source_key: string;
  version: number;
  title: string;
  publisher: string;
  heading: string | null;
  text: string;
  url: string | null;
}

const toChunk = (r: ChunkRow): EvidenceChunk => ({
  chunkId: r.chunk_id,
  documentId: r.document_id,
  sourceKey: r.source_key,
  version: r.version,
  title: r.title,
  publisher: r.publisher,
  heading: r.heading,
  text: r.text,
  url: r.url,
});

/**
 * Full-text search over approved, in-date knowledge visible to one tenant
 * (its own sources plus global ones). Only the newest version of a source is used.
 */
export class DbKnowledge implements KnowledgePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantId: string,
  ) {}

  async search(query: string, opts: { concernCodes?: string[]; limit?: number } = {}): Promise<EvidenceChunk[]> {
    const terms = [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 24);
    if (terms.length === 0) return [];
    const codes = opts.concernCodes ?? [];
    const rows = await this.prisma.$queryRaw<ChunkRow[]>`
      WITH current_docs AS (
        SELECT DISTINCT ON (coalesce(d.tenant_id::text, ''), d.source_key) d.*
        FROM knowledge_documents d
        WHERE d.status = 'APPROVED'
          AND d.review_due_at > now()
          AND (d.tenant_id IS NULL OR d.tenant_id = ${this.tenantId}::uuid)
        ORDER BY coalesce(d.tenant_id::text, ''), d.source_key, d.version DESC
      )
      SELECT c.id AS chunk_id, d.id AS document_id, d.source_key, d.version, d.title, d.publisher, c.heading, c.text, d.url
      FROM knowledge_chunks c
      JOIN current_docs d ON d.id = c.document_id
      WHERE to_tsvector('english', coalesce(c.heading, '') || ' ' || c.text) @@ to_tsquery('english', ${terms.join(' | ')})
        AND (cardinality(${codes}::text[]) = 0 OR d.concern_codes && ${codes}::text[])
      ORDER BY ts_rank(to_tsvector('english', coalesce(c.heading, '') || ' ' || c.text), to_tsquery('english', ${terms.join(' | ')})) DESC
      LIMIT ${opts.limit ?? 4}`;
    return rows.map(toChunk);
  }

  async bySourceKeys(sourceKeys: string[], perSource = 2): Promise<EvidenceChunk[]> {
    if (sourceKeys.length === 0) return [];
    const rows = await this.prisma.$queryRaw<(ChunkRow & { rn: bigint })[]>`
      WITH current_docs AS (
        SELECT DISTINCT ON (coalesce(d.tenant_id::text, ''), d.source_key) d.*
        FROM knowledge_documents d
        WHERE d.status = 'APPROVED'
          AND d.review_due_at > now()
          AND d.source_key = ANY(${sourceKeys}::text[])
          AND (d.tenant_id IS NULL OR d.tenant_id = ${this.tenantId}::uuid)
        ORDER BY coalesce(d.tenant_id::text, ''), d.source_key, d.version DESC
      ), ranked AS (
        SELECT c.id AS chunk_id, d.id AS document_id, d.source_key, d.version, d.title, d.publisher, c.heading, c.text, d.url,
               row_number() OVER (PARTITION BY d.source_key ORDER BY c.ordinal) AS rn
        FROM knowledge_chunks c JOIN current_docs d ON d.id = c.document_id
      )
      SELECT * FROM ranked WHERE rn <= ${perSource}
      ORDER BY array_position(${sourceKeys}::text[], source_key), rn`;
    return rows.map(toChunk);
  }
}
