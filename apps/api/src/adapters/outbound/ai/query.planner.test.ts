import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelClient } from './model.client.js';
import { QueryPlanner } from './query.planner.js';

test('plans bounded evidence queries with actual provider metadata and a ten-second generation budget', async (t) => {
  t.mock.method(ModelClient.prototype, 'complete', async (request: Parameters<ModelClient['complete']>[0]) => {
    assert.deepEqual(request.input, { question: 'Who approved the move, and who owns that login?', initialEvidence: [] });
    assert.equal(request.budgetMs, 10_000);
    assert.equal(request.maxOutputTokens, 512);
    assert.equal(request.schemaName, 'query_plan');
    assert.match(request.instruction, /Do not answer/);
    return { value: { queries: ['approval audit record', ' login owner '] }, provider: 'groq', model: 'actual-model' };
  });
  assert.deepEqual(await new QueryPlanner().plan('Who approved the move, and who owns that login?', []), {
    queries: ['approval audit record', 'login owner'], provider: 'groq', model: 'actual-model', promptVersion: 'question-plan-v2',
  });
});

test('rejects malformed, unbounded, empty, duplicate, or extra planner output', async (t) => {
  const complete = t.mock.method(ModelClient.prototype, 'complete');
  const planner = new QueryPlanner();
  for (const value of [null, [], {}, { queries: [] }, { queries: ['a', 'b', 'c', 'd'] },
    { queries: [' '] }, { queries: [1] }, { queries: ['a'.repeat(201)] },
    { queries: ['Audit', ' audit '] }, { queries: ['audit'], answer: 'invented fact' }]) {
    complete.mock.mockImplementation(async () => ({ value, provider: 'groq', model: 'actual-model' }));
    await assert.rejects(planner.plan('Who approved?', []), /Query planner returned/);
  }
});

test('planning failure remains visible instead of fabricating search queries', async (t) => {
  t.mock.method(ModelClient.prototype, 'complete', async () => { throw new Error('Model provider rate limit reached'); });
  await assert.rejects(new QueryPlanner().plan('Who approved?', []), /rate limit reached/);
});

test('grounds follow-up identifiers in retrieved evidence and rejects invented dates', async (t) => {
  const evidence = { id: 'audit:0:30', path: 'audit.md', content: 'Account p-04 approved at 23:17.', startOffset: 0, endOffset: 30 };
  const complete = t.mock.method(ModelClient.prototype, 'complete', async (request: Parameters<ModelClient['complete']>[0]) => {
    assert.deepEqual(request.input, { question: 'Who owns the approving login?',
      initialEvidence: [{ path: 'audit.md', content: evidence.content }] });
    return { value: { queries: ['p-04 account owner', '23:17 approval audit'] }, provider: 'groq', model: 'actual-model' };
  });
  const planner = new QueryPlanner();
  assert.deepEqual((await planner.plan('Who owns the approving login?', [evidence])).queries,
    ['p-04 account owner', '23:17 approval audit']);
  complete.mock.mockImplementation(async () => ({ value: { queries: ['financial statements 2023'] }, provider: 'groq', model: 'actual-model' }));
  await assert.rejects(planner.plan('Who owns the approving login?', [evidence]), /identifier absent/);
  await assert.rejects(planner.plan('Who owns the approving login?', Array.from({ length: 4 }, () => evidence)), /three bounded/);
});
