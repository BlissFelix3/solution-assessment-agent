export type WorkflowNodeRun = {
  index: number;
  status: 'success' | 'error' | 'running' | 'unknown';
  startedAt: string | null;
  durationMs: number | null;
  sourceNames: string[];
  inputs: Record<string, unknown>[];
  outputs: Record<string, unknown>[];
  inputCount: number;
  outputCount: number;
  truncated: boolean;
};

export type WorkflowNode = {
  id: string;
  name: string;
  type: string;
  position: [number, number];
  runs: WorkflowNodeRun[];
};

export type WorkflowConnection = {
  from: string;
  to: string;
  outputIndex: number;
  inputIndex: number;
};

export type WorkflowExecution = {
  executionId: string;
  workflowId: string;
  workflowName: string;
  status: 'new' | 'running' | 'success' | 'error' | 'canceled' | 'crashed' | 'waiting' | 'unknown';
  startedAt: string | null;
  stoppedAt: string | null;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
};
