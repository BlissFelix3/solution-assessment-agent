import type { CollectionId, RetrievalMode } from '../../domain/collections.js';

export interface WorkflowStarter {
  hourlyLimit(): number | undefined;
  start(questions: string[] | undefined, options: { collectionId: CollectionId; retrievalMode: RetrievalMode }): Promise<{ runId: string; sourceRevisionId: string }>;
}
