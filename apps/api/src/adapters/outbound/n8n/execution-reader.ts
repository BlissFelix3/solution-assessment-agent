import type { OnModuleDestroy } from '@nestjs/common';
import { parse } from 'flatted';
import pg from 'pg';
import type { WorkflowReader } from '../../../application/ports/workflow-reader.js';
import type { WorkflowConnection, WorkflowExecution, WorkflowNode, WorkflowNodeRun } from '../../../domain/workflow.js';

const maxItems = 50;
const maxDataBytes = 2 * 1024 * 1024;
const publicFields = new Set([
  'runId', 'executionId', 'sourceRevisionId', 'questionId', 'verdict', 'explanation', 'basis', 'notProof',
  'missingEvidence', 'createdAt', 'requirements', 'assessments', 'implementationPath', 'status', 'id',
  'label', 'question', 'path', 'quote', 'reason', 'readiness', 'action', 'body',
  'collectionId', 'retrievalMode', 'scenario',
]);

// This adapter reads the database execution format used by the pinned n8n 2.39.10.
// Headers, URLs, credentials and arbitrary transport errors never cross its public boundary.
export class N8nExecutionReader implements WorkflowReader, OnModuleDestroy {
  private readonly pool: pg.Pool | null;
  private readonly workflowId: string | undefined;

  constructor(private readonly warn: (message: string) => void) {
    const connectionString = process.env.N8N_DATABASE_URL;
    this.workflowId = process.env.N8N_WORKFLOW_ID;
    this.pool = connectionString && this.workflowId
      ? new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 2_000, statement_timeout: 2_000 })
      : null;
    this.pool?.on('error', () => this.warn('The n8n execution inspector is unavailable'));
  }

  async read(executionId: string): Promise<WorkflowExecution | null> {
    if (!this.pool || !this.workflowId || !/^\d{1,10}$/.test(executionId) ||
        BigInt(executionId) > 2_147_483_647n) return null;
    try {
      const result = await this.pool.query<Record<string, unknown>>(
        `SELECT e.id::text AS "executionId", e."workflowId", e.status,
                e."startedAt", e."stoppedAt", d."workflowData", d.data
         FROM execution_entity e
         JOIN execution_data d ON d."executionId" = e.id
         WHERE e.id = $1 AND e."workflowId" = $2 AND e."deletedAt" IS NULL
               AND octet_length(d.data) <= $3`,
        [executionId, this.workflowId, maxDataBytes],
      );
      const row = result.rows[0];
      if (!row) return null;
      const execution = projectWorkflowExecution(row, executionId, this.workflowId);
      if (!execution) this.warn('The n8n execution snapshot could not be read');
      return execution;
    } catch {
      // A missing inspector must not stop an assessment or reveal an upstream error.
      this.warn('The n8n execution inspector is unavailable');
      return null;
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function timestamp(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number'
    ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

type PreviewBudget = { values: number; characters: number };

function safeValue(value: unknown, depth: number, limit: { truncated: boolean }, budget: PreviewBudget): unknown {
  if (depth > 8 || budget.values <= 0) {
    limit.truncated = true;
    return null;
  }
  budget.values -= 1;
  if (typeof value === 'string') {
    const length = Math.min(value.length, 20_000, budget.characters);
    if (length < value.length) limit.truncated = true;
    budget.characters -= length;
    return value.slice(0, length);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    if (value.length > maxItems) limit.truncated = true;
    return value.slice(0, maxItems).map((item: unknown) => safeValue(item, depth + 1, limit, budget));
  }
  if (!isRecord(value)) return null;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => publicFields.has(key))
    .map(([key, item]) => [key, safeValue(item, depth + 1, limit, budget)]));
}

function items(run: unknown, outputIndex?: number): unknown[] {
  if (!isRecord(run) || !isRecord(run.data) || !Array.isArray(run.data.main)) return [];
  if (outputIndex !== undefined) {
    const output: unknown = run.data.main[outputIndex];
    return Array.isArray(output) ? output : [];
  }
  return run.data.main.flatMap((output: unknown) => Array.isArray(output) ? output : []);
}

function projectItems(values: unknown[], limit: { truncated: boolean }, budget: PreviewBudget): Record<string, unknown>[] {
  if (values.length > maxItems) limit.truncated = true;
  return values.slice(0, maxItems).map((item: unknown) => {
    if (!isRecord(item) || !isRecord(item.json)) return {};
    const projected = safeValue(item.json, 0, limit, budget);
    return isRecord(projected) ? projected : {};
  });
}

function projectNodeRun(
  value: unknown, index: number, runData: Record<string, unknown>, names: Set<string>, budget: PreviewBudget,
): WorkflowNodeRun | null {
  if (!isRecord(value)) return null;
  const sourceNames: string[] = [];
  const upstream: unknown[] = [];
  if (Array.isArray(value.source)) {
    for (const source of value.source.slice(0, 100)) {
      if (!isRecord(source) || !text(source.previousNode) || !names.has(source.previousNode)) continue;
      sourceNames.push(source.previousNode);
      const runs: unknown = runData[source.previousNode];
      const runIndex = typeof source.previousNodeRun === 'number' && Number.isSafeInteger(source.previousNodeRun)
        ? source.previousNodeRun : 0;
      const outputIndex = typeof source.previousNodeOutput === 'number' && Number.isSafeInteger(source.previousNodeOutput)
        ? source.previousNodeOutput : 0;
      if (runIndex >= 0 && outputIndex >= 0 && Array.isArray(runs)) {
        upstream.push(...items(runs[runIndex], outputIndex));
      }
    }
  }
  const outputs = items(value);
  const limit = { truncated: false };
  return {
    index,
    status: value.executionStatus === 'success' || value.executionStatus === 'error' ||
      value.executionStatus === 'running' ? value.executionStatus : 'unknown',
    startedAt: timestamp(value.startTime),
    durationMs: typeof value.executionTime === 'number' && Number.isFinite(value.executionTime) &&
      value.executionTime >= 0 ? value.executionTime : null,
    sourceNames,
    inputs: projectItems(upstream, limit, budget),
    outputs: projectItems(outputs, limit, budget),
    inputCount: upstream.length,
    outputCount: outputs.length,
    truncated: limit.truncated,
  };
}

export function projectWorkflowExecution(row: unknown, executionId: string, workflowId: string): WorkflowExecution | null {
  if (!isRecord(row) || row.executionId !== executionId || row.workflowId !== workflowId ||
      typeof row.data !== 'string' || Buffer.byteLength(row.data) > maxDataBytes ||
      !isRecord(row.workflowData) || !text(row.workflowData.name) ||
      row.workflowData.id !== workflowId || !Array.isArray(row.workflowData.nodes) ||
      row.workflowData.nodes.length > 100 || !isRecord(row.workflowData.connections)) return null;
  let data: unknown;
  try {
    data = parse(row.data);
  } catch {
    return null;
  }
  if (!isRecord(data) || !isRecord(data.resultData) || !isRecord(data.resultData.runData)) return null;
  const runData = data.resultData.runData;
  const nodes: WorkflowNode[] = [];
  for (const node of row.workflowData.nodes) {
    if (!isRecord(node) || !text(node.id) || !text(node.name) || !text(node.type) ||
        !Array.isArray(node.position) || node.position.length !== 2 ||
        !node.position.every((coordinate: unknown) => typeof coordinate === 'number' &&
          Number.isFinite(coordinate) && Math.abs(coordinate) <= 100_000)) return null;
    const x: unknown = node.position[0];
    const y: unknown = node.position[1];
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    nodes.push({
      id: node.id,
      name: node.name,
      type: node.type,
      position: [x, y],
      runs: [],
    });
  }
  const names = new Set(nodes.map((node) => node.name));
  if (names.size !== nodes.length || new Set(nodes.map((node) => node.id)).size !== nodes.length) return null;
  // Flatted can describe many references to a small cycle. Share a budget across the
  // execution so depth-limited previews cannot expand that cycle exponentially.
  const budget: PreviewBudget = { values: 5_000, characters: 500_000 };
  for (const node of nodes) {
    const runs: unknown = runData[node.name];
    node.runs = Array.isArray(runs) ? runs.slice(0, 10).flatMap((run: unknown, index) => {
      const projected = projectNodeRun(run, index, runData, names, budget);
      return projected ? [projected] : [];
    }) : [];
  }
  const connections: WorkflowConnection[] = [];
  for (const [from, value] of Object.entries(row.workflowData.connections)) {
    if (!names.has(from) || !isRecord(value) || !Array.isArray(value.main)) continue;
    value.main.slice(0, 10).forEach((output: unknown, outputIndex) => {
      if (!Array.isArray(output)) return;
      for (const connection of output.slice(0, 100)) {
        if (!isRecord(connection) || !text(connection.node) || !names.has(connection.node) ||
            typeof connection.index !== 'number' || !Number.isSafeInteger(connection.index) ||
            connection.index < 0 || connection.index >= 100 || connections.length >= 1_000) continue;
        connections.push({ from, to: connection.node, outputIndex, inputIndex: connection.index });
      }
    });
  }
  const status = row.status;
  return {
    executionId,
    workflowId,
    workflowName: row.workflowData.name,
    status: status === 'new' || status === 'running' || status === 'success' || status === 'error' ||
      status === 'canceled' || status === 'crashed' || status === 'waiting' ? status : 'unknown',
    startedAt: timestamp(row.startedAt),
    stoppedAt: timestamp(row.stoppedAt),
    nodes,
    connections,
  };
}
