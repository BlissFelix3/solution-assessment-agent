import assert from 'node:assert/strict';
import test from 'node:test';
import { stringify } from 'flatted';
import pg from 'pg';
import { N8nExecutionReader, projectWorkflowExecution } from './execution-reader.js';

const workflowId = 'assessment-workflow';
const startedAt = '2026-10-03T10:00:00.000Z';
const definition = {
  id: workflowId,
  name: 'Assessment workflow',
  nodes: [
    { id: 'start', name: 'Start assessment', type: 'n8n-nodes-base.webhook', position: [0, 0] },
    { id: 'prepare', name: 'Prepare requirements', type: 'n8n-nodes-base.code', position: [220, 0] },
    { id: 'unused', name: 'Start locally', type: 'n8n-nodes-base.manualTrigger', position: [0, 200] },
  ],
  connections: {
    'Start assessment': { main: [[{ node: 'Prepare requirements', type: 'main', index: 0 }]] },
  },
};

function row(runData: Record<string, unknown>) {
  return {
    executionId: '42', workflowId, status: 'success', startedAt: new Date(startedAt),
    stoppedAt: '2026-10-03T10:00:00.015Z', workflowData: definition,
    data: stringify({ version: 1, resultData: { runData } }),
  };
}

test('reads actual n8n timings and upstream input while removing transport secrets at every depth', () => {
  const raw = row({
    'Start assessment': [{
      startTime: new Date(startedAt).getTime(), executionTime: 1, executionStatus: 'success', source: [],
      data: { main: [[{ json: {
        headers: { 'x-demo-token': 'private-webhook-secret' },
        webhookUrl: 'https://private.example/path?token=private-url-secret',
        body: { requirements: ['What happened to the signal?'], collectionId: 'mystery',
          apiKey: 'private-body-secret', nested: { token: 'private-nested-secret' } },
      } }]] },
    }],
    'Prepare requirements': [{
      startTime: new Date(startedAt).getTime() + 1, executionTime: 14, executionStatus: 'success',
      source: [{ previousNode: 'Start assessment', previousNodeOutput: 0, previousNodeRun: 0 }],
      data: { main: [[{ json: {
        runId: 'public-run', executionId: '42', questionId: 'question-1', apiBaseUrl: 'http://private-api',
        requirements: [{ id: 'question-1', question: 'What happened?', headers: { authorization: 'private-token' } }],
        basis: [{ path: 'log.md', quote: 'The signal stopped.', credential: 'private-citation-secret' }],
        assessments: [{ questionId: 'question-1', verdict: 'supported',
          explanation: 'The recording was stopped locally.', apiKey: 'private-assessment-secret' }],
      } }]] },
    }],
  });
  const execution = projectWorkflowExecution(raw, '42', workflowId);
  assert(execution);
  assert.equal(execution.startedAt, startedAt);
  assert.equal(execution.stoppedAt, '2026-10-03T10:00:00.015Z');
  assert.deepEqual(execution.connections, [{ from: 'Start assessment', to: 'Prepare requirements', outputIndex: 0, inputIndex: 0 }]);
  const prepared = execution.nodes.find((node) => node.name === 'Prepare requirements')?.runs[0];
  assert(prepared);
  assert.equal(prepared.status, 'success');
  assert.equal(prepared.durationMs, 14);
  assert.equal(prepared.inputCount, 1);
  assert.deepEqual(prepared.sourceNames, ['Start assessment']);
  assert.deepEqual(prepared.inputs, [{ body: { requirements: ['What happened to the signal?'], collectionId: 'mystery' } }]);
  assert.deepEqual(prepared.outputs, [{ runId: 'public-run', executionId: '42', questionId: 'question-1',
    requirements: [{ id: 'question-1', question: 'What happened?' }],
    basis: [{ path: 'log.md', quote: 'The signal stopped.' }],
    assessments: [{ questionId: 'question-1', verdict: 'supported',
      explanation: 'The recording was stopped locally.' }] }]);
  assert.deepEqual(execution.nodes.find((node) => node.name === 'Start locally')?.runs, []);
  const serialized = JSON.stringify(execution);
  assert(!serialized.includes('private-'));
  assert(!serialized.includes('private.example'));
  assert(!serialized.includes('apiBaseUrl'));
});

test('resolves the exact prior run and branch output rather than taking the last upstream result', () => {
  const raw = row({
    'Start assessment': [
      { data: { main: [[{ json: { questionId: 'first-branch' } }], [{ json: { questionId: 'second-branch' } }]] } },
      { data: { main: [[{ json: { questionId: 'later-run' } }]] } },
    ],
    'Prepare requirements': [{
      executionStatus: 'error', executionTime: 5, startTime: new Date(startedAt).getTime(),
      source: [{ previousNode: 'Start assessment', previousNodeOutput: 1, previousNodeRun: 0 }],
      error: { message: 'private-error-token' },
    }],
  });
  const execution = projectWorkflowExecution(raw, '42', workflowId);
  const run = execution?.nodes.find((node) => node.name === 'Prepare requirements')?.runs[0];
  assert(run);
  assert.deepEqual(run.inputs, [{ questionId: 'second-branch' }]);
  assert.equal(run.inputCount, 1);
  assert.equal(run.outputCount, 0);
  assert.equal(run.status, 'error');
  assert(!JSON.stringify(execution).includes('private-error-token'));
});

test('bounds displayed items and text and marks truncated data', () => {
  const raw = row({
    'Start assessment': [{
      executionStatus: 'success',
      data: { main: [Array.from({ length: 60 }, (_, i) => ({ json: { questionId: `question-${i}`, explanation: 'x'.repeat(20_100) } }))] },
    }],
  });
  const run = projectWorkflowExecution(raw, '42', workflowId)?.nodes[0]?.runs[0];
  assert(run);
  assert.equal(run.outputCount, 60);
  assert.equal(run.outputs.length, 50);
  assert.equal(String(run.outputs[0]?.explanation).length, 20_000);
  assert.equal(run.truncated, true);
  assert(JSON.stringify(run).length < 550_000);
});

test('a circular execution item is projected into a bounded serializable preview', () => {
  const body: Record<string, unknown> = { collectionId: 'mystery', token: 'private-cycle-secret' };
  body.body = body;
  const raw = row({
    'Start assessment': [{ data: { main: [[{ json: { body } }]] } }],
  });
  const execution = projectWorkflowExecution(raw, '42', workflowId);
  assert(execution);
  assert.equal(execution.nodes[0]?.runs[0]?.truncated, true);
  const serialized = JSON.stringify(execution);
  assert(!serialized.includes('private-cycle-secret'));
  assert(serialized.length < 5_000);
});

test('a branching circular array cannot expand beyond the shared execution preview budget', () => {
  const values: unknown[] = [];
  values.push(...Array.from({ length: 50 }, () => values));
  const raw = row({
    'Start assessment': [{ data: { main: [[{ json: { body: values } }]] } }],
  });
  assert(raw.data.length < 1_000);
  const execution = projectWorkflowExecution(raw, '42', workflowId);
  assert(execution);
  assert.equal(execution.nodes[0]?.runs[0]?.truncated, true);
  assert(JSON.stringify(execution).length < 2_000_000);
});

test('returns no inspector for a foreign workflow, wrong execution, corrupt data or malformed topology', () => {
  const raw = row({});
  assert.equal(projectWorkflowExecution(raw, '43', workflowId), null);
  assert.equal(projectWorkflowExecution(raw, '42', 'foreign-workflow'), null);
  assert.equal(projectWorkflowExecution({ ...raw, data: 'not flatted json' }, '42', workflowId), null);
  assert.equal(projectWorkflowExecution({ ...raw, data: stringify({ resultData: null }) }, '42', workflowId), null);
  assert.equal(projectWorkflowExecution({ ...raw, workflowData: { ...definition, nodes: [{ id: 'node' }] } }, '42', workflowId), null);
  assert.equal(projectWorkflowExecution({ ...raw, workflowData: { ...definition,
    nodes: [...definition.nodes, definition.nodes[0]] } }, '42', workflowId), null);
});

test('an unconfigured inspector returns null without requiring an n8n connection', async (t) => {
  const previousUrl = process.env.N8N_DATABASE_URL;
  const previousWorkflow = process.env.N8N_WORKFLOW_ID;
  delete process.env.N8N_DATABASE_URL;
  delete process.env.N8N_WORKFLOW_ID;
  const warnings: string[] = [];
  const reader = new N8nExecutionReader((message) => warnings.push(message));
  t.after(async () => {
    await reader.onModuleDestroy();
    if (previousUrl === undefined) delete process.env.N8N_DATABASE_URL;
    else process.env.N8N_DATABASE_URL = previousUrl;
    if (previousWorkflow === undefined) delete process.env.N8N_WORKFLOW_ID;
    else process.env.N8N_WORKFLOW_ID = previousWorkflow;
  });
  assert.equal(await reader.read('42'), null);
  assert.equal(await reader.read('not-an-execution'), null);
  assert.deepEqual(warnings, []);
});

test('a connection failure leaves the inspector unavailable and exposes no database credentials', async (t) => {
  const previousUrl = process.env.N8N_DATABASE_URL;
  const previousWorkflow = process.env.N8N_WORKFLOW_ID;
  process.env.N8N_DATABASE_URL = 'postgresql://demo:synthetic-secret@127.0.0.1:1/unavailable';
  process.env.N8N_WORKFLOW_ID = workflowId;
  const warnings: string[] = [];
  const reader = new N8nExecutionReader((message) => warnings.push(message));
  t.after(async () => {
    await reader.onModuleDestroy();
    if (previousUrl === undefined) delete process.env.N8N_DATABASE_URL;
    else process.env.N8N_DATABASE_URL = previousUrl;
    if (previousWorkflow === undefined) delete process.env.N8N_WORKFLOW_ID;
    else process.env.N8N_WORKFLOW_ID = previousWorkflow;
  });
  assert.equal(await reader.read('42'), null);
  assert.deepEqual(warnings, ['The n8n execution inspector is unavailable']);
  assert(!warnings.join(' ').includes('synthetic-secret'));
});

test('an idle connection error remains a safe observer warning rather than an unhandled process error', async (t) => {
  const previousUrl = process.env.N8N_DATABASE_URL;
  const previousWorkflow = process.env.N8N_WORKFLOW_ID;
  process.env.N8N_DATABASE_URL = 'postgresql://unused@127.0.0.1:1/unavailable';
  process.env.N8N_WORKFLOW_ID = workflowId;
  t.mock.method(pg.Pool.prototype, 'query', async function (this: pg.Pool) {
    this.emit('error', new Error('private-idle-connection-error'));
    return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
  });
  const warnings: string[] = [];
  const reader = new N8nExecutionReader((message) => warnings.push(message));
  t.after(async () => {
    await reader.onModuleDestroy();
    if (previousUrl === undefined) delete process.env.N8N_DATABASE_URL;
    else process.env.N8N_DATABASE_URL = previousUrl;
    if (previousWorkflow === undefined) delete process.env.N8N_WORKFLOW_ID;
    else process.env.N8N_WORKFLOW_ID = previousWorkflow;
  });
  assert.equal(await reader.read('42'), null);
  assert.deepEqual(warnings, ['The n8n execution inspector is unavailable']);
});
