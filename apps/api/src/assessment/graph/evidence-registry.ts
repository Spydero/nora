import type { EvidenceChunk } from '../../knowledge/knowledge.port.js';
import type { EvidenceRef } from '../result.types.js';

const EXCERPT_CHARS = 600;

const STOP_WORDS = new Set(
  'the and for are but not you your yours with this that these those from have has had can could may might will would should into onto over under than then there their them they what when where which while who whom why how all any each few more most other some such only own same too very just also about after again against because been before being below between both down during further here once off out until upon its it’s our ours ourselves yourself yourselves were was does did doing nor now see get got'.split(
    ' ',
  ),
);

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');

/** Content words of a text, lightly stemmed, for matching a claim to the passage that supports it. */
export function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
      .map(stem),
  );
}

/** How many content words a claim shares with a passage. */
export function claimOverlap(claim: string, passage: string): number {
  const passageWords = contentWords(passage);
  return [...contentWords(claim)].filter((w) => passageWords.has(w)).length;
}

/**
 * The passage that supports a claim: the one the content names by heading,
 * otherwise the one sharing the most content words with it. A source's first
 * passage is only a last resort, so a warning sign isn't cited to a passage
 * about common causes.
 */
export function bestPassage<T extends { heading: string | null; text: string }>(passages: T[], claim: string, heading?: string): T | undefined {
  if (heading) {
    const named = passages.find((p) => p.heading === heading);
    if (named) return named;
  }
  let best: T | undefined;
  let bestScore = -1;
  for (const p of passages) {
    const score = claimOverlap(claim, `${p.heading ?? ''} ${p.text}`);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/** Content words a passage must share with a claim to support it when the content doesn't name the passage. */
export const MIN_SUPPORT = 2;

/** A passage supports a claim when the approved content names it, or when it shares enough of the claim's words. */
export function supports(passage: { heading: string | null; text: string }, claim: string, heading?: string): boolean {
  return (!!heading && passage.heading === heading) || claimOverlap(claim, passage.text) >= MIN_SUPPORT;
}

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

  /**
   * The retrieved passage of a source that supports this claim. A claim no
   * passage supports, such as "book an appointment within 24–48 hours", gets
   * no citation rather than an unrelated one.
   */
  forClaim(sourceKey: string, claim: string, heading?: string): string | undefined {
    const passages = this.list()
      .filter((r) => r.sourceKey === sourceKey)
      .map((r) => ({ ...r, text: r.excerpt }));
    const best = bestPassage(passages, claim, heading);
    return best && supports(best, claim, heading) ? best.citationId : undefined;
  }

  list(): EvidenceRef[] {
    return [...this.byChunk.values()];
  }
}
