import assert from 'node:assert/strict';
import test from 'node:test';
import type { RunTrace, TraceEvent } from './api.js';
import { eventsFor, nodeStatus } from './flow.js';

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
    events: [created, {
      ...created, id: '2', stage: 'generation', status: 'started', questionId, attemptId: 'attempt-1',
    }],
  };

  assert.equal(nodeStatus(timedOut, 'generation', questionId), 'unconfirmed');
  assert.equal(nodeStatus(timedOut, 'workflow', questionId), 'unconfirmed');
  assert.equal(nodeStatus(timedOut, 'validation', questionId), 'waiting');
});

test('uses only the selected requirement when deriving stage evidence and status', () => {
  const selected: TraceEvent = {
    ...created, id: '2', stage: 'retrieval', questionId, attemptId: 'attempt-1',
  };
  const other: TraceEvent = {
    ...selected, id: '3', questionId: 'first-attempt-60-seconds', status: 'failed',
  };
  const mixed = { ...trace, events: [created, selected, other] };

  assert.deepEqual(eventsFor(mixed, 'retrieval', questionId), [selected]);
  assert.equal(nodeStatus(mixed, 'retrieval', questionId), 'succeeded');
  assert.equal(nodeStatus(mixed, 'retrieval', 'first-attempt-60-seconds'), 'failed');
  assert.deepEqual(eventsFor(mixed, 'workflow', questionId), [created]);
  assert.equal(nodeStatus(null, 'retrieval', questionId), 'waiting');
});
