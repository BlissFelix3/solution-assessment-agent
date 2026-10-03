import type { EmbeddingIdentity } from '../../domain/retrieval.js';

export interface TextEmbedder {
  readonly identity: EmbeddingIdentity;
  embed(texts: readonly string[]): Promise<number[][]>;
}
