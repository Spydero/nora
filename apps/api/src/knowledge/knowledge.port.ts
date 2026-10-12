export interface EvidenceChunk {
  chunkId: string;
  documentId: string;
  sourceKey: string;
  version: number;
  title: string;
  publisher: string;
  heading: string | null;
  text: string;
  url: string | null;
}

/** Read-only access to the approved knowledge library. */
export interface KnowledgePort {
  search(query: string, opts?: { concernCodes?: string[]; limit?: number }): Promise<EvidenceChunk[]>;
  bySourceKeys(sourceKeys: string[], perSource?: number): Promise<EvidenceChunk[]>;
}
