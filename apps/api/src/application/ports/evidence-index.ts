import type { ContextWindow, EmbeddingIdentity, EvidenceIndexManifest, ScoredChunk } from '../../domain/retrieval.js';

export interface EvidenceIndex {
  findIndex(sourceRevisionId: string, embedding: EmbeddingIdentity): Promise<EvidenceIndexManifest | undefined>;
  searchKeyword(indexId: string, question: string, limit: number): Promise<ScoredChunk[]>;
  searchSemantic(indexId: string, vector: readonly number[], limit: number): Promise<ScoredChunk[]>;
  expandContext(indexId: string, chunkIds: readonly string[]): Promise<ContextWindow[]>;
}
