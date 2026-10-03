import { RetrievalService } from './retrieval.service.js';
import type { WorkflowReader } from './ports/workflow-reader.js';
import type { RetrievalResult } from '../domain/retrieval.js';
import { preparedRequirements } from '../domain/requirements.js';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { AssessmentModel } from '../adapters/outbound/ai/assessment.model.js';
import type { ModelEvent } from './ports/assessment-generator.js';
import type { AssessmentToSave } from '../domain/assessment.js';
import { Database } from '../adapters/outbound/postgres/database.js';
import { RunsRepository } from '../adapters/outbound/postgres/runs.repository.js';
import { RunsService } from './runs.service.js';
import type { RunEvent } from '../domain/run-trace.js';
import { AssessmentError } from '../domain/errors.js';

const runId = '00000000-0000-4000-8000-000000000001';
const questionId = 'employee-saml-sign-in';
const question = 'Can employees sign in with SAML 2.0?';
const sources = [{ path: 'authentication.md', content: 'Employees can sign in with SAML 2.0.' }];

function setup(t: TestContext, createdAt = new Date()) {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://unused@localhost/unused';
  t.after(() => {
    if (previousUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousUrl;
    }
  });
  const database = new Database();
  t.after(() => database.onModuleDestroy());
  const runs = new RunsRepository(database);
  const model = new AssessmentModel();
  const retrieval = new RetrievalService({
    findIndex: async () => undefined,
    searchKeyword: async () => [],
    searchSemantic: async () => [],
    expandContext: async () => [],
  }, {
    identity: { model: 'test', revision: 'test', dimensions: 384, dtype: 'q8' },
    embed: async () => [],
  }, {
    identity: { model: 'test-reranker', revision: 'test', dtype: 'q8' },
    score: async () => [],
  }, {
    plan: async (input) => ({ queries: [input], provider: 'groq', model: 'test', promptVersion: 'test' }),
  });
  const workflow: WorkflowReader = { read: async () => null };
  t.mock.method(retrieval, 'retrieve', async (_revision: string, input: string): Promise<RetrievalResult> => ({
    mode: 'keyword', sourceRevisionId: 'revision-1', indexId: 'test-index',
    embedding: { model: 'test', revision: 'test', dimensions: 384, dtype: 'q8' },
    reranker: null, rerankDurationMs: null, queryPlan: null, reranks: [],
    searches: [{ query: input, startedAt: createdAt.toISOString(), completedAt: createdAt.toISOString(),
      keyword: sources.map((source) => ({ ...source, id: 'chunk-1', startOffset: 0,
        endOffset: source.content.length, score: 1 })), semantic: [] }],
    chunkerVersion: 'test', totalChunks: 1, candidateLimit: 20, contextLimit: 5,
    contextCharacterLimit: 6000, rrfK: 60,
    candidates: sources.map((source) => ({ ...source, id: 'chunk-1', startOffset: 0,
      endOffset: source.content.length, lexicalRank: 1, semanticRank: null, lexicalScore: 1,
      cosineSimilarity: null, fusionScore: 1 / 61, fusionRank: 1, rerankScore: null,
      rerankRank: null, selectedRank: 1, selection: 'selected' })),
    context: sources.map((source) => ({ ...source, id: 'chunk-1', seedChunkId: 'chunk-1', startOffset: 0, endOffset: source.content.length })),
  }));
  t.mock.method(runs, 'findRun', async () => ({
    collectionId: 'northstar' as const,
    retrievalMode: 'keyword' as const,
    executionId: '42',
    sourceRevisionId: 'revision-1',
    status: 'pending' as const,
    createdAt,
    implementationPath: null,
    requirements: preparedRequirements,
  }));
  t.mock.method(runs, 'searchKeyword', async () => sources.map((source) => ({ ...source, score: 1 })));
  const events: RunEvent[] = [];
  t.mock.method(runs, 'appendEvent', async (id: string, event: RunEvent) => {
    assert.equal(id, runId);
    events.push(event);
  });
  return { runs, model, events, workflow,
    service: new RunsService(runs, model, console.warn, retrieval, workflow) };
}

test('reads n8n only through the execution ID saved on the requested run', async (t) => {
  const { workflow, service } = setup(t);
  const read = t.mock.method(workflow, 'read', async (executionId: string) => {
    assert.equal(executionId, '42');
    return null;
  });
  assert.equal(await service.getWorkflow(runId), null);
  assert.equal(read.mock.callCount(), 1);
});

test('a missing run cannot read an n8n execution', async (t) => {
  const { runs, workflow, service } = setup(t);
  t.mock.method(runs, 'findRun', async () => undefined);
  const read = t.mock.method(workflow, 'read', async () => null);
  await assert.rejects(service.getWorkflow(runId),
    (error: unknown) => error instanceof AssessmentError && error.code === 'not_found');
  assert.equal(read.mock.callCount(), 0);
});

test('a legacy run with no linked execution returns no n8n snapshot', async (t) => {
  const { runs, workflow, service } = setup(t);
  const run = await runs.findRun(runId);
  assert(run);
  t.mock.method(runs, 'findRun', async () => ({ ...run, executionId: null }));
  const read = t.mock.method(workflow, 'read', async () => null);
  assert.equal(await service.getWorkflow(runId), null);
  assert.equal(read.mock.callCount(), 0);
});

test('retrieves, validates, and saves a cited assessment with one ordered attempt', async (t) => {
  const { runs, model, events, service } = setup(t);
  assert.equal(await service.getWorkflow(runId), null);
  t.mock.method(runs, 'findAssessment', async () => undefined);
  t.mock.method(model, 'generate', async (
    inputQuestion: string,
    inputSources: readonly { path: string; content: string }[],
  ) => {
    assert.equal(inputQuestion, question);
    assert.deepEqual(inputSources, sources);
    return {
      verdict: 'supported',
      explanation: 'SAML sign-in is documented.',
      basis: [{ path: 'authentication.md', quote: sources[0]!.content }],
      notProof: [],
      missingEvidence: null,
      runId: 'ignored-model-id',
    };
  });
  const save = t.mock.method(runs, 'saveOrGetAssessment', async (assessment: AssessmentToSave) => {
    assert.equal(assessment.runId, runId);
    assert.equal(assessment.questionId, questionId);
    assert.equal(assessment.verdict, 'supported');
    return { ...assessment, createdAt: new Date('2026-09-29T00:00:00Z') };
  });

  const result = await service.assess(runId, questionId);
  assert.equal(result.sourceRevisionId, 'revision-1');
  assert.equal(result.basis[0]?.quote, sources[0]!.content);
  assert.equal(save.mock.callCount(), 1);
  assert.deepEqual(events.map(({ stage, status }) => [stage, status]), [
    ['retrieval', 'started'], ['retrieval', 'succeeded'],
    ['generation', 'started'], ['generation', 'succeeded'],
    ['validation', 'started'], ['validation', 'succeeded'], ['persistence', 'started'],
  ]);
  const attemptId = events[0]?.attemptId;
  assert.match(attemptId ?? '', /^[0-9a-f-]{36}$/);
  assert(events.every((event) => event.attemptId === attemptId && event.questionId === questionId));
  assert.equal(save.mock.calls[0]?.arguments[1], attemptId);
  assert.deepEqual(events[1]?.data.context, sources.map((source) => ({ ...source,
    id: 'chunk-1', seedChunkId: 'chunk-1', startOffset: 0, endOffset: source.content.length })));
  assert.equal(events[1]?.data.mode, 'keyword');
  assert.equal(events[1]?.data.indexId, 'test-index');
  assert.equal(JSON.stringify(events).includes('ignored-model-id'), false);
});

test('returns a saved assessment without asking the model again', async (t) => {
  const { runs, model, events, service } = setup(t);
  const saved = {
    runId,
    questionId,
    verdict: 'supported' as const,
    explanation: 'SAML sign-in is documented.',
    basis: [{ path: 'authentication.md', quote: sources[0]!.content }],
    notProof: [],
    missingEvidence: null,
    createdAt: new Date('2026-09-29T00:00:00Z'),
  };
  t.mock.method(runs, 'findAssessment', async () => saved);
  const generate = t.mock.method(model, 'generate', async () => { throw new Error('Unexpected model call'); });

  assert.deepEqual(await service.assess(runId, questionId), { ...saved, sourceRevisionId: 'revision-1' });
  assert.equal(generate.mock.callCount(), 0);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.stage, 'persistence');
  assert.equal(events[0]?.data.reused, true);
});

test('does not save a model quote absent from retrieved sources', async (t) => {
  const { runs, model, events, service } = setup(t);
  t.mock.method(runs, 'findAssessment', async () => undefined);
  t.mock.method(model, 'generate', async () => ({
    verdict: 'supported',
    explanation: 'SAML sign-in is documented.',
    basis: [{ path: 'authentication.md', quote: 'Invented guarantee.' }],
    notProof: [],
    missingEvidence: null,
  }));
  const save = t.mock.method(runs, 'saveOrGetAssessment', async () => {
    throw new Error('Unexpected save');
  });

  await assert.rejects(service.assess(runId, questionId), /absent from retrieved sources/);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(events.at(-1)?.stage, 'validation');
  assert.equal(events.at(-1)?.status, 'failed');
  assert.equal(events.some((event) => event.stage === 'persistence'), false);
});

test('records a safe model failure and gives a retry a separate attempt identity', async (t) => {
  const { runs, model, events, service } = setup(t);
  t.mock.method(runs, 'findAssessment', async () => undefined);
  t.mock.method(model, 'generate', async () => { throw new Error('secret-provider-detail'); });
  const save = t.mock.method(runs, 'saveOrGetAssessment', async () => { throw new Error('Unexpected save'); });

  await assert.rejects(service.assess(runId, questionId), /secret-provider-detail/);
  await assert.rejects(service.assess(runId, questionId), /secret-provider-detail/);
  assert.equal(save.mock.callCount(), 0);
  const failures = events.filter((event) => event.status === 'failed');
  assert.equal(failures.length, 2);
  assert(failures.every((event) => event.stage === 'generation'));
  assert.notEqual(failures[0]?.attemptId, failures[1]?.attemptId);
  assert.equal(JSON.stringify(events).includes('secret-provider-detail'), false);
});

test('preserves the actual failure when failure tracing is unavailable', async (t) => {
  const { runs, model, service } = setup(t);
  t.mock.method(runs, 'findAssessment', async () => undefined);
  t.mock.method(model, 'generate', async () => { throw new Error('Model unavailable'); });
  t.mock.method(runs, 'appendEvent', async (_id: string, event: RunEvent) => {
    if (event.status === 'failed') throw new Error('Trace unavailable');
  });

  await assert.rejects(service.assess(runId, questionId), /Model unavailable/);
});

test('returns stored trace history without re-running retrieval or the model', async (t) => {
  const { runs, model, service } = setup(t);
  const events = [{
    id: '1', stage: 'workflow' as const, status: 'succeeded' as const,
    questionId: null, attemptId: null, createdAt: new Date(), data: { executionId: '42' },
  }];
  t.mock.method(runs, 'listEvents', async () => events);
  const search = t.mock.method(runs, 'searchKeyword', async () => { throw new Error('Unexpected retrieval'); });
  const generate = t.mock.method(model, 'generate', async () => { throw new Error('Unexpected model'); });

  const trace = await service.getTrace(runId);
  assert.equal(trace.executionId, '42');
  assert.equal(trace.sourceRevisionId, 'revision-1');
  assert.deepEqual(trace.events, events);
  assert.equal(search.mock.callCount(), 0);
  assert.equal(generate.mock.callCount(), 0);
});

test('lists saved assessments with their pinned source revision', async (t) => {
  const { runs, service } = setup(t);
  const saved = {
    runId,
    questionId,
    verdict: 'supported' as const,
    explanation: 'SAML sign-in is documented.',
    basis: [{ path: 'authentication.md', quote: sources[0]!.content }],
    notProof: [],
    missingEvidence: null,
    createdAt: new Date('2026-09-29T00:00:00Z'),
  };
  t.mock.method(runs, 'listAssessments', async () => [saved]);

  assert.deepEqual(await service.listAssessments(runId), {
    runId,
    sourceRevisionId: 'revision-1',
    status: 'pending',
    assessments: [saved],
    implementationPath: null,
    requirements: preparedRequirements,
  });
});

test('saves one dossier path after all three assessments exist', async (t) => {
  const { runs, service } = setup(t);
  const common = {
    runId,
    explanation: 'Assessment completed.',
    basis: [],
    notProof: [],
    missingEvidence: null,
    createdAt: new Date('2026-09-29T00:00:00Z'),
  };
  t.mock.method(runs, 'listAssessments', async () => [
    { ...common, questionId: 'employee-saml-sign-in', verdict: 'supported' as const },
    { ...common, questionId: 'https-account-event-webhook', verdict: 'supported' as const },
    {
      ...common,
      questionId: 'first-attempt-60-seconds',
      verdict: 'unknown' as const,
      missingEvidence: 'A first-attempt guarantee.',
    },
  ]);
  const save = t.mock.method(runs, 'saveImplementationPath', async (_id: string, path: Parameters<RunsRepository['saveImplementationPath']>[1]) => path);

  const dossier = await service.createDossier(runId);
  assert.equal(dossier.implementationPath[2]?.readiness, 'needs_evidence');
  assert.equal(save.mock.callCount(), 1);
});

test('does not save a dossier from partial assessments', async (t) => {
  const { runs, service } = setup(t);
  t.mock.method(runs, 'listAssessments', async () => []);
  const save = t.mock.method(runs, 'saveImplementationPath', async () => []);

  await assert.rejects(service.createDossier(runId), /needs all submitted assessments/);
  assert.equal(save.mock.callCount(), 0);
});

test('shows timed out when a pending run is older than ten minutes', async (t) => {
  const { runs, service } = setup(t, new Date(Date.now() - 11 * 60 * 1000));
  t.mock.method(runs, 'listAssessments', async () => []);

  assert.equal((await service.listAssessments(runId)).status, 'timed_out');
});

test('completes a run only after the repository accepts its saved results', async (t) => {
  const { runs, service } = setup(t);
  const complete = t.mock.method(runs, 'complete', async () => true);

  assert.deepEqual(await service.complete(runId), { runId, status: 'completed' });
  assert.equal(complete.mock.callCount(), 1);
});

test('rejects an incomplete run instead of displaying success', async (t) => {
  const { runs, service } = setup(t);
  t.mock.method(runs, 'complete', async () => false);

  await assert.rejects(service.complete(runId), /Run is incomplete or failed/);
});

test('rejects a missing n8n execution ID before creating a run', async (t) => {
  const { runs, service } = setup(t);
  const create = t.mock.method(runs, 'create', async () => undefined);

  await assert.rejects(service.create(undefined), /Expected an n8n execution ID/);
  assert.equal(create.mock.callCount(), 0);
});

test('opens a source only from the run revision', async (t) => {
  const { runs, service } = setup(t);
  const findSource = t.mock.method(runs, 'findSource', async (
    sourceRevisionId: string,
    path: string,
  ) => {
    assert.equal(sourceRevisionId, 'revision-1');
    assert.equal(path, 'authentication.md');
    return sources[0];
  });

  assert.deepEqual(await service.getSource(runId, 'authentication.md'), {
    sourceRevisionId: 'revision-1',
    ...sources[0],
  });
  await assert.rejects(service.getSource(runId, ''), /Expected a source path/);
  assert.equal(findSource.mock.callCount(), 1);
});

test('does not substitute a source from another revision', async (t) => {
  const { runs, service } = setup(t);
  t.mock.method(runs, 'findSource', async () => undefined);

  await assert.rejects(service.getSource(runId, 'authentication.md'), /Source not found in run revision/);
});

test('retrieves the submitted question from its run rather than a prepared global question', async (t) => {
  const { runs, service } = setup(t);
  const submitted = [
    { id: 'requirement-1', label: 'Requirement 1', question: 'Can we replay a failed webhook?' },
  ];
  t.mock.method(runs, 'findRun', async () => ({
    collectionId: 'northstar' as const,
    retrievalMode: 'keyword' as const,
    executionId: '42',
    sourceRevisionId: 'revision-1',
    status: 'pending' as const,
    createdAt: new Date(),
    implementationPath: null,
    requirements: submitted,
  }));
  const search = t.mock.method(runs, 'searchKeyword', async (revision: string, input: string) => {
    assert.equal(revision, 'revision-1');
    assert.equal(input, submitted[0]!.question);
    return [];
  });
  assert.equal(
    (await service.search(runId, 'requirement-1', 'keyword')).question,
    submitted[0]!.question,
  );
  await assert.rejects(
    service.assess(runId, 'employee-saml-sign-in'),
    /Unknown questionId for this run/,
  );
  assert.equal(search.mock.callCount(), 1);
});

test('records fallback provider identity with the same retrieval context and safe failure reason', async (t) => {
  const { runs, model, events, service } = setup(t);
  t.mock.method(runs, 'findAssessment', async () => undefined);
  const draft = {
    verdict: 'supported' as const,
    explanation: 'SAML sign-in is documented.',
    basis: [{ path: 'authentication.md', quote: sources[0]!.content }],
    notProof: [],
    missingEvidence: null,
  };
  t.mock.method(
    model,
    'generate',
    async (
      _question: string,
      _sources: readonly { path: string; content: string }[],
      onEvent?: (event: ModelEvent) => Promise<void>,
    ) => {
      assert(onEvent);
      await onEvent({ provider: 'groq', model: 'openai/gpt-oss-20b', status: 'started' });
      await onEvent({
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        status: 'failed',
        reason: 'Model provider rate limit reached',
      });
      await onEvent({ provider: 'cerebras', model: 'gpt-oss-120b', status: 'started' });
      return draft;
    },
  );
  t.mock.method(runs, 'saveOrGetAssessment', async (assessment: AssessmentToSave) => ({
    ...assessment,
    createdAt: new Date(),
  }));
  await service.assess(runId, questionId);
  const attempts = events.filter((event) => event.stage === 'generation' && event.data.provider);
  assert.deepEqual(
    attempts.map(({ data, status }) => [data.provider, data.model, status]),
    [
      ['groq', 'openai/gpt-oss-20b', 'started'],
      ['groq', 'openai/gpt-oss-20b', 'failed'],
      ['cerebras', 'gpt-oss-120b', 'started'],
    ],
  );
  assert.deepEqual(attempts[2]?.data.sources, sources);
  assert.equal(attempts[1]?.data.reason, 'Model provider rate limit reached');
  assert.equal(attempts[2]?.data.thinkingBudget, undefined);
  assert.equal(attempts[2]?.data.reasoningEffort, 'low');
  assert(events.every((event) => event.attemptId === events[0]?.attemptId));
});
