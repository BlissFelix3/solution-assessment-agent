import type { RerankerIdentity, SourceChunk } from '../../domain/retrieval.js';

export interface EvidenceReranker {
  readonly identity: RerankerIdentity;
  score(question: string, chunks: readonly SourceChunk[]): Promise<number[]>;
}
