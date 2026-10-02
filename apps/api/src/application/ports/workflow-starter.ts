export interface WorkflowStarter {
  hourlyLimit(): number | undefined;
  start(questions: string[] | undefined): Promise<{ runId: string; sourceRevisionId: string }>;
}
