import { requirements } from '../../../domain/assessment.js';
import type { Assessment, RunTrace } from '../../../domain/assessment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getRecordedExecution,
  getRunProgress,
  startDemo,
  getRunTrace,
} from './api.js';

const runId = '3993517a-a532-4c7e-8805-bad3ec8ca4da';
const trace: RunTrace = {
  requirements,
  runId,
  executionId: '42',
  sourceRevisionId: 'fixture:test',
  createdAt: '2026-09-30T10:00:00.000Z',
  status: 'completed',
  events: [
    {
      id: '1',
      stage: 'completion',
      status: 'succeeded',
      questionId: null,
      attemptId: null,
      createdAt: '2026-09-30T10:00:01.000Z',
      data: { assessmentCount: 3 },
    },
  ],
};
const assessments: Assessment[] = [
  'employee-saml-sign-in',
  'https-account-event-webhook',
  'first-attempt-60-seconds',
].map((questionId) => ({
  questionId,
  verdict: 'unknown',
  explanation: 'The retrieved documents do not establish this requirement.',
  basis: [],
  notProof: [],
  missingEvidence: 'An explicit statement of support or rejection.',
}));
const implementationPath = assessments.map(({ questionId }) => ({
  questionId,
  readiness: 'needs_evidence',
  action: 'Obtain written confirmation before making this promise.',
}));
const progress = {
  runId,
  sourceRevisionId: trace.sourceRevisionId,
  status: 'completed',
  assessments,
  implementationPath,
};

test('loads a completed recorded execution with the actual run identity', async (context) => {
  context.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    assert.equal(path, '/recorded-execution.json');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ trace, progress });
  });

  const recorded = await getRecordedExecution(new AbortController().signal);

  assert.deepEqual(recorded.trace, trace);
  assert.deepEqual(recorded.progress, {
    status: 'completed',
    requirements,
    assessments,
    implementationPath,
  });
});

test('rejects recorded results belonging to another run or source revision', async (context) => {
  for (const mismatchedProgress of [
    { ...progress, runId: '5c2c53a5-c2fa-49df-abfc-3e4c1cddf36e' },
    { ...progress, sourceRevisionId: 'fixture:another-revision' },
  ]) {
    context.mock.method(globalThis, 'fetch', async () =>
      Response.json({ trace, progress: mismatchedProgress }),
    );

    await assert.rejects(getRecordedExecution(new AbortController().signal), /response is invalid/);
  }
});

test('rejects a recording that has not completed or has no recorded events', async (context) => {
  for (const recording of [
    { trace: { ...trace, status: 'pending' }, progress },
    { trace, progress: { ...progress, status: 'pending' } },
    { trace: { ...trace, events: [] }, progress },
  ]) {
    context.mock.method(globalThis, 'fetch', async () => Response.json(recording));

    await assert.rejects(
      getRecordedExecution(new AbortController().signal),
      /execution is incomplete/,
    );
  }
});

test('rejects a completed recording that is missing saved assessments or its dossier', async (context) => {
  for (const incompleteProgress of [
    { ...progress, assessments: assessments.slice(0, 2) },
    { ...progress, implementationPath: null },
  ]) {
    context.mock.method(globalThis, 'fetch', async () =>
      Response.json({ trace, progress: incompleteProgress }),
    );

    await assert.rejects(getRecordedExecution(new AbortController().signal), /response is invalid/);
  }
});

test('rejects malformed live traces before rendering them', async (context) => {
  const event = trace.events[0];
  for (const malformedTrace of [
    { ...trace, runId: 'another-run' },
    { ...trace, executionId: 42 },
    { ...trace, createdAt: 'not-a-date' },
    { ...trace, events: [{ ...event, stage: 'invented-stage' }] },
    { ...trace, events: [{ ...event, data: [] }] },
    { ...trace, events: [{ ...event, attemptId: undefined }] },
  ]) {
    context.mock.method(globalThis, 'fetch', async () => Response.json(malformedTrace));

    await assert.rejects(getRunTrace(runId, new AbortController().signal), /response is invalid/);
  }
});

test('accepts legacy traces without an n8n execution ID or events', async (context) => {
  const legacy = { ...trace, executionId: null, events: [] };
  context.mock.method(globalThis, 'fetch', async () => Response.json(legacy));

  assert.deepEqual(await getRunTrace(runId, new AbortController().signal), legacy);
});

test('submits editable requirements instead of starting a prepared replay', async (context) => {
  context.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    assert.equal(path, '/runs/demo');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(String(options.body)), {
      requirements: ['Can we replay webhooks?'],
    });
    return Response.json({ runId }, { status: 202 });
  });
  assert.equal(await startDemo(['Can we replay webhooks?']), runId);
});

test('accepts a completed custom one-question run and rejects mismatched outputs', async (context) => {
  const submitted = [
    { id: 'requirement-1', label: 'Requirement 1', question: 'Can we replay webhooks?' },
  ];
  const custom = {
    ...progress,
    requirements: submitted,
    assessments: [{ ...assessments[0], questionId: 'requirement-1' }],
    implementationPath: [{ ...implementationPath[0], questionId: 'requirement-1' }],
  };
  context.mock.method(globalThis, 'fetch', async () => Response.json(custom));
  assert.equal((await getRunProgress(runId, new AbortController().signal)).assessments.length, 1);
  for (const value of [
    { ...custom, assessments: [{ ...assessments[0], questionId: 'foreign' }] },
    { ...custom, implementationPath: [{ ...implementationPath[0], questionId: 'foreign' }] },
    { ...custom, assessments: [] },
    { ...custom, requirements: [] },
    { ...custom, requirements: [submitted[0], submitted[0]] },
  ]) {
    context.mock.method(globalThis, 'fetch', async () => Response.json(value));
    await assert.rejects(getRunProgress(runId, new AbortController().signal), /invalid/);
  }
});
