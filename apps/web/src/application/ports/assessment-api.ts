import type { RunProgress, RunTrace, SourceDocument } from '../../domain/assessment.js';

export interface AssessmentApi {
  startDemo(questions: string[]): Promise<string>;
  getRunProgress(runId: string, signal: AbortSignal): Promise<RunProgress>;
  getRunTrace(runId: string, signal: AbortSignal): Promise<RunTrace>;
  getRecordedExecution(signal: AbortSignal): Promise<{ trace: RunTrace; progress: RunProgress }>;
  getSource(runId: string, path: string, signal: AbortSignal): Promise<SourceDocument>;
}
