import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { AssessmentModel } from './assessment.model.js';
import type { AssessmentToSave } from './assessment.js';
import { Database } from './database.js';
import { RunsRepository } from './runs.repository.js';
import { RunsService } from './runs.service.js';

const runId = '00000000-0000-4000-8000-000000000001';
const questionId = 'employee-saml-sign-in';
const question = 'Can employees sign in with SAML 2.0?';
const sources = [{ path: 'authentication.md', content: 'Employees can sign in with SAML 2.0.' }];

function setup(t: TestContext) {
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
  t.mock.method(runs, 'findSourceRevision', async () => 'revision-1');
  t.mock.method(runs, 'searchKeyword', async () => sources.map((source) => ({ ...source, score: 1 })));
  return { runs, model, service: new RunsService(runs, model) };
}

test('retrieves, validates, and saves a cited assessment', async (t) => {
  const { runs, model, service } = setup(t);
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
});

test('returns a saved assessment without asking the model again', async (t) => {
  const { runs, model, service } = setup(t);
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
});

test('does not save a model quote absent from retrieved sources', async (t) => {
  const { runs, model, service } = setup(t);
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
    assessments: [saved],
  });
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
