import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { AssessmentToSave } from './assessment.js';
import { Database } from './database.js';
import { buildImplementationPath } from './implementation-path.js';
import { RunsRepository } from './runs.repository.js';

test('persists immutable execution evidence atomically with run outputs', {
  skip: !process.env.TEST_DATABASE_URL,
}, async (t) => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const database = new Database();
  const repository = new RunsRepository(database);
  t.after(async () => {
    await database.onModuleDestroy();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });
  const executionId = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const run = await repository.create(executionId);
  assert(run, 'Seed the test database before running the repository test');
  const createdEvents = await repository.listEvents(run.id);
  assert.equal(createdEvents.length, 1);
  assert.equal(createdEvents[0]?.data.executionId, executionId);

  const assessment: AssessmentToSave = {
    runId: run.id, questionId: 'employee-saml-sign-in', verdict: 'supported',
    explanation: 'SAML is documented.', basis: [{ path: 'sso.md', quote: 'SAML is supported.' }],
    notProof: [], missingEvidence: null,
  };

  // An invalid trace UUID must roll back the assessment in the same SQL statement.
  await assert.rejects(repository.saveOrGetAssessment(assessment, 'invalid-uuid'));
  assert.equal(await repository.findAssessment(run.id, assessment.questionId), undefined);

  const attempts = Array.from({ length: 6 }, () => randomUUID());
  const concurrent = await Promise.all(attempts.map((attemptId) =>
    repository.saveOrGetAssessment(assessment, attemptId)));
  assert(concurrent.every((saved) => saved.createdAt.getTime() === concurrent[0]!.createdAt.getTime()));
  assert.equal((await repository.listAssessments(run.id)).length, 1);
  const savedEvents = (await repository.listEvents(run.id)).filter((event) => event.stage === 'persistence');
  assert.equal(savedEvents.length, 6);
  assert.equal(savedEvents.filter((event) => event.data.reused === false).length, 1);
  assert.equal(savedEvents.filter((event) => event.data.reused === true).length, 5);
  assert.deepEqual(new Set(savedEvents.map((event) => event.attemptId)), new Set(attempts));

  assert.equal(await repository.complete(run.id), false);
  assert.equal((await repository.listEvents(run.id)).some((event) => event.stage === 'completion'), false);
  await repository.saveOrGetAssessment({ ...assessment, questionId: 'https-account-event-webhook' }, randomUUID());
  await repository.saveOrGetAssessment({
    ...assessment, questionId: 'first-attempt-60-seconds', verdict: 'unknown',
    basis: [], missingEvidence: 'A documented first-attempt timing guarantee.',
  }, randomUUID());
  const path = buildImplementationPath(await repository.listAssessments(run.id));
  assert.deepEqual(await repository.saveImplementationPath(run.id, path), path);
  assert.deepEqual(await repository.saveImplementationPath(run.id, path), path);
  assert.equal(await repository.complete(run.id), true);
  assert.equal(await repository.complete(run.id), true);
  await repository.failExecution(executionId);
  const finished = await repository.findRun(run.id);
  assert.equal(finished?.status, 'completed');
  const completedEvents = await repository.listEvents(run.id);
  assert.equal(completedEvents.filter((event) => event.stage === 'dossier').length, 1);
  assert.equal(completedEvents.filter((event) => event.stage === 'completion').length, 1);
  assert.equal(completedEvents.some((event) => event.status === 'failed'), false);
  assert.deepEqual(completedEvents.map((event) => BigInt(event.id)),
    completedEvents.map((event) => BigInt(event.id)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0));
  await assert.rejects(database.pool.query('UPDATE run_events SET data = $1 WHERE run_id = $2', ['{}', run.id]), /immutable/);
  await assert.rejects(database.pool.query('DELETE FROM run_events WHERE run_id = $1', [run.id]), /immutable/);

  const failedRun = await repository.create(`${executionId}1`);
  assert(failedRun);
  await repository.failExecution(`${executionId}1`);
  await repository.failExecution(`${executionId}1`);
  assert.equal((await repository.findRun(failedRun.id))?.status, 'failed');
  assert.equal((await repository.listEvents(failedRun.id)).filter((event) => event.status === 'failed').length, 1);
});
