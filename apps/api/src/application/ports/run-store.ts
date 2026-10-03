import type { CollectionId, RetrievalMode } from '../../domain/collections.js';
import type { AssessmentToSave } from '../../domain/assessment.js';
import type { ImplementationStep } from '../../domain/implementation-path.js';
import type { Requirement } from '../../domain/requirements.js';
import type { RunEvent } from '../../domain/run-trace.js';

export type StoredRun = {
  collectionId: CollectionId;
  retrievalMode: RetrievalMode;
  requirements: Requirement[];
  executionId: string | null;
  sourceRevisionId: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: Date;
  implementationPath: ImplementationStep[] | null;
};
export type StoredAssessment = AssessmentToSave & { createdAt: Date };
export type StoredEvent = RunEvent & { id: string; createdAt: Date };

export interface RunStore {
  create(executionId: string, requirements: Requirement[], collectionId: CollectionId, retrievalMode: RetrievalMode): Promise<{
    id: string;
    sourceRevisionId: string;
    requirements: Requirement[];
  } | undefined>;
  findRun(id: string): Promise<StoredRun | undefined>;
  complete(id: string): Promise<boolean>;
  failExecution(executionId: string): Promise<void>;
  admitDemoStart(maxPerHour: number): Promise<boolean>;
  saveImplementationPath(
    id: string,
    path: ImplementationStep[],
  ): Promise<ImplementationStep[] | null | undefined>;
  searchKeyword(sourceRevisionId: string, question: string): Promise<{
    path: string;
    content: string;
    score: number;
  }[]>;
  findAssessment(runId: string, questionId: string): Promise<StoredAssessment | undefined>;
  listAssessments(runId: string): Promise<StoredAssessment[]>;
  findSource(
    sourceRevisionId: string,
    path: string,
  ): Promise<{ path: string; content: string } | undefined>;
  saveOrGetAssessment(assessment: AssessmentToSave, attemptId: string): Promise<StoredAssessment>;
  appendEvent(runId: string, event: RunEvent): Promise<void>;
  listEvents(runId: string): Promise<StoredEvent[]>;
}
