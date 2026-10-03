import type { WorkflowExecution } from '../../domain/workflow.js';

export interface WorkflowReader {
  read(executionId: string): Promise<WorkflowExecution | null>;
}
