import { requirements } from './api.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Assessment, RunProgress, RunTrace, TraceEvent } from './api.js';
import { eventsFor, executionMessage, n8nNodeStatus, nodeStatus, replayExecution } from './flow.js';

const questionId = 'employee-saml-sign-in';
const created: TraceEvent = {
  id: '1',
  stage: 'workflow',
  status: 'succeeded',
  questionId: null,
  attemptId: null,
  createdAt: '2026-09-30T10:00:00.000Z',
  data: { sourceRevisionId: 'fixture:test' },
};
const trace: RunTrace = {
  requirements,
  runId: '3993517a-a532-4c7e-8805-bad3ec8ca4da',
  executionId: '42',
  sourceRevisionId: 'fixture:test',
  createdAt: created.createdAt,
  status: 'pending',
  events: [created],
};

test('does not report completed orchestration when n8n has only created a pending run', () => {
  assert.equal(nodeStatus(trace, 'workflow', questionId), 'started');
  assert.equal(nodeStatus({ ...trace, status: 'completed' }, 'workflow', questionId), 'succeeded');
  assert.equal(nodeStatus({ ...trace, status: 'failed' }, 'workflow', questionId), 'failed');
});

test('keeps pinned evidence successful after the workflow fails', () => {
  const failed: RunTrace = {
    ...trace,
    status: 'failed',
    events: [created, { ...created, id: '2', status: 'failed' }],
  };

  assert.deepEqual(eventsFor(failed, 'sources', questionId), [created]);
  assert.equal(nodeStatus(failed, 'sources', questionId), 'succeeded');
});

test('marks unfinished work unconfirmed when the run times out', () => {
  const timedOut: RunTrace = {
    ...trace,
    status: 'timed_out',
    events: [
      created,
      {
        ...created,
        id: '2',
        stage: 'generation',
        status: 'started',
        questionId,
        attemptId: 'attempt-1',
      },
    ],
  };

  assert.equal(nodeStatus(timedOut, 'generation', questionId), 'unconfirmed');
  assert.equal(nodeStatus(timedOut, 'workflow', questionId), 'unconfirmed');
  assert.equal(nodeStatus(timedOut, 'validation', questionId), 'waiting');
});

test('uses only the selected requirement when deriving stage evidence and status', () => {
  const selected: TraceEvent = {
    ...created,
    id: '2',
    stage: 'retrieval',
    questionId,
    attemptId: 'attempt-1',
  };
  const other: TraceEvent = {
    ...selected,
    id: '3',
    questionId: 'first-attempt-60-seconds',
    status: 'failed',
  };
  const mixed = { ...trace, events: [created, selected, other] };

  assert.deepEqual(eventsFor(mixed, 'retrieval', questionId), [selected]);
  assert.equal(nodeStatus(mixed, 'retrieval', questionId), 'succeeded');
  assert.equal(nodeStatus(mixed, 'retrieval', 'first-attempt-60-seconds'), 'failed');
  assert.deepEqual(eventsFor(mixed, 'workflow', questionId), [created]);
  assert.equal(nodeStatus(null, 'retrieval', questionId), 'waiting');
});

test('recorded playback does not reveal future saved answers or the dossier', () => {
  const assessment: Assessment = {
    questionId,
    verdict: 'unknown',
    explanation: 'The sources do not establish the requirement.',
    notProof: [],
    basis: [],
    missingEvidence: 'A documented guarantee.',
  };
  const events: TraceEvent[] = [
    created,
    { ...created, id: '2', stage: 'validation', questionId },
    { ...created, id: '3', stage: 'persistence', questionId },
    { ...created, id: '4', stage: 'dossier' },
    { ...created, id: '5', stage: 'completion' },
  ];
  const completed: RunTrace = { ...trace, events, status: 'completed' };
  const progress: RunProgress = {
    requirements,
    status: 'completed',
    assessments: [assessment],
    implementationPath: [
      { questionId, readiness: 'needs_evidence', action: 'Confirm the guarantee.' },
    ],
  };
  const beforeSave = replayExecution(completed, progress, 2);
  assert.equal(beforeSave.trace.status, 'pending');
  assert.deepEqual(beforeSave.progress.assessments, []);
  assert.equal(beforeSave.progress.implementationPath, null);
  const afterSave = replayExecution(completed, progress, 3);
  assert.deepEqual(afterSave.progress.assessments, [assessment]);
  assert.equal(afterSave.progress.implementationPath, null);
  const dossier = replayExecution(completed, progress, 4);
  assert.deepEqual(dossier.progress.implementationPath, progress.implementationPath);
  assert.equal(dossier.trace.status, 'pending');
  assert.equal(replayExecution(completed, progress, 5).trace.status, 'completed');
});

test('progress text follows observed retrieval and generation rather than invented thinking', () => {
  assert.equal(executionMessage(null, false), 'See how your answer is built');
  assert.equal(executionMessage(null, true), 'Sending your question to n8n…');
  assert.equal(
    executionMessage(
      { ...trace, events: [{ ...created, stage: 'retrieval', status: 'started' }] },
      false,
    ),
    'Retrieving relevant documentation…',
  );
  assert.equal(
    executionMessage(
      { ...trace, events: [{ ...created, stage: 'generation', status: 'started' }] },
      false,
    ),
    'Reading the evidence and generating an answer…',
  );
});

test('a failed model attempt never appears as a generated answer or completed assessment', () => {
  const failed: RunTrace = {
    ...trace,
    events: [{ ...created, stage: 'generation', status: 'failed' }],
  };
  assert.equal(executionMessage(failed, false), 'An attempt failed. Inspect the execution receipts.');
  assert.equal(
    executionMessage({ ...failed, status: 'failed' }, false),
    'The workflow stopped. Inspect the receipts below.',
  );
  assert.equal(
    executionMessage({ ...failed, status: 'timed_out' }, false),
    'The workflow has not reported an outcome.',
  );
});

test('workflow badges preserve confirmed calls and do not invent code-node or foreign-question telemetry', () => {
  const failed: RunTrace = {
    ...trace,
    status: 'failed',
    events: [
      created,
      { ...created, id: '2', stage: 'persistence', questionId },
      { ...created, id: '3', stage: 'generation', questionId: 'other', status: 'failed' },
      { ...created, id: '4', status: 'failed' },
    ],
  };
  assert.equal(n8nNodeStatus(failed, 'Create run', questionId), 'succeeded');
  assert.equal(n8nNodeStatus(failed, 'Assess requirement', questionId), 'succeeded');
  assert.equal(n8nNodeStatus(failed, 'Assess requirement', 'other'), 'failed');
  assert.equal(n8nNodeStatus(failed, 'Check results', questionId), undefined);
  assert.equal(n8nNodeStatus(failed, 'Complete run', questionId), undefined);
  const unfinished: RunTrace = {
    ...trace,
    status: 'timed_out',
    events: [{ ...created, stage: 'retrieval', questionId }],
  };
  assert.equal(n8nNodeStatus(unfinished, 'Assess requirement', questionId), 'unconfirmed');
});
