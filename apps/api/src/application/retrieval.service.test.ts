import assert from 'node:assert/strict';
import test from 'node:test';
import { AssessmentError } from '../domain/errors.js';
import type { EmbeddingIdentity, ScoredChunk } from '../domain/retrieval.js';
import type { EvidenceIndex } from './ports/evidence-index.js';
import type { TextEmbedder } from './ports/text-embedder.js';
import type { QuestionPlanner } from './ports/question-planner.js';
import type { EvidenceReranker } from './ports/evidence-reranker.js';
import { RetrievalService } from './retrieval.service.js';

const identity: EmbeddingIdentity = { model: 'test-encoder', revision: 'fixed-revision', dimensions: 384, dtype: 'q8' };
const planner: QuestionPlanner = {
  async plan(question) { return { queries: [question], provider: 'groq', model: 'test-planner', promptVersion: 'test-v1' }; },
};
const vector = [1, ...Array<number>(383).fill(0)];
const reranker: EvidenceReranker = {
  identity: { model: 'test-reranker', revision: 'fixed-reranker-revision', dtype: 'q8' },
  async score(_question, chunks) { return chunks.map(() => 2); },
};
const evidence: ScoredChunk = {
  id: 'entry.md:0:30', path: 'entry.md', content: 'The courier entered at 21:17.',
  startOffset: 0, endOffset: 28, score: 0.8,
};

const expandContext: EvidenceIndex['expandContext'] = async (_indexId, ids) => {
  assert.deepEqual(ids, [evidence.id]);
  return [{ id: evidence.id, path: evidence.path, content: evidence.content,
    startOffset: evidence.startOffset, endOffset: evidence.endOffset, seedChunkId: evidence.id }];
};

test('combines pinned lexical and semantic results and returns selected evidence only as context', async () => {
  const calls: string[] = [];
  const embedder: TextEmbedder = { identity, async embed(texts) {
    assert.deepEqual(texts, ['Who entered after closing?']); calls.push('embed'); return [vector];
  } };
  const index: EvidenceIndex = {
    expandContext,
    async findIndex(revision, model) {
      assert.equal(revision, 'revision-old'); assert.deepEqual(model, identity);
      return { id: 'old-index', sourceRevisionId: revision, embedding: identity, chunkerVersion: 'v1', totalChunks: 8 };
    },
    async searchKeyword(id, question, limit) {
      assert.equal(id, 'old-index'); assert.equal(question, 'Who entered after closing?');
      assert.equal(limit, 20); calls.push('keyword'); return [];
    },
    async searchSemantic(id, input, limit) {
      assert.equal(id, 'old-index'); assert.deepEqual(input, vector); assert.equal(limit, 20);
      calls.push('semantic'); return [evidence];
    },
  };
  const result = await new RetrievalService(index, embedder, reranker, planner).retrieve('revision-old', 'Who entered after closing?');
  assert.deepEqual(calls, ['embed', 'keyword', 'semantic']);
  assert.equal(result.mode, 'hybrid');
  assert.equal(result.sourceRevisionId, 'revision-old');
  assert.equal(result.candidates[0]?.lexicalRank, null);
  assert.equal(result.candidates[0]?.semanticRank, 1);
  assert.equal(result.candidates[0]?.rerankScore, 2);
  assert.deepEqual(result.reranker, reranker.identity);
  assert.equal(result.context[0]?.content, evidence.content);
  assert(!('score' in result.context[0]!));
});

test('an unavailable revision index fails before embedding or searching instead of claiming hybrid retrieval', async () => {
  const index: EvidenceIndex = {
    expandContext,
    async findIndex() { return undefined; },
    async searchKeyword() { throw new Error('Unexpected search'); },
    async searchSemantic() { throw new Error('Unexpected search'); },
  };
  const embedder: TextEmbedder = { identity, async embed() { throw new Error('Unexpected embedding'); } };
  await assert.rejects(new RetrievalService(index, embedder, reranker, planner).retrieve('missing-revision', 'Who entered?'),
    (error: unknown) => error instanceof AssessmentError && error.code === 'unavailable');
});

test('keyword comparison uses the same chunk catalog and does not execute the embedding model', async () => {
  const index: EvidenceIndex = {
    expandContext,
    async findIndex(revision) {
      return { id: 'same-index', sourceRevisionId: revision, embedding: identity, chunkerVersion: 'v1', totalChunks: 8 };
    },
    async searchKeyword() { return [evidence]; },
    async searchSemantic() { throw new Error('Unexpected vector search'); },
  };
  const embedder: TextEmbedder = { identity, async embed() { throw new Error('Unexpected embedding'); } };
  const unusedReranker: EvidenceReranker = { identity: reranker.identity,
    async score() { throw new Error('Unexpected reranking'); } };
  const result = await new RetrievalService(index, embedder, unusedReranker, { async plan() { throw new Error('Unexpected planning'); } }).retrieve('revision-old', 'courier', 'keyword');
  assert.equal(result.mode, 'keyword');
  assert.equal(result.candidates[0]?.lexicalRank, 1);
  assert.equal(result.candidates[0]?.semanticRank, null);
  assert.equal(result.reranker, null);
  assert.equal(result.rerankDurationMs, null);
});

test('semantic failure rejects the hybrid operation without silently falling back to lexical retrieval', async () => {
  const index: EvidenceIndex = {
    expandContext,
    async findIndex(revision) {
      return { id: 'same-index', sourceRevisionId: revision, embedding: identity, chunkerVersion: 'v1', totalChunks: 8 };
    },
    async searchKeyword() { return [evidence]; },
    async searchSemantic() { throw new Error('Vector query failed'); },
  };
  const embedder: TextEmbedder = { identity, async embed() { return [vector]; } };
  await assert.rejects(new RetrievalService(index, embedder, reranker, planner).retrieve('revision-old', 'Who entered?'), /Vector query failed/);
});

test('invalid reranker output fails instead of publishing an incomplete ranking', async () => {
  const index: EvidenceIndex = {
    expandContext,
    async findIndex(revision) {
      return { id: 'same-index', sourceRevisionId: revision, embedding: identity, chunkerVersion: 'v1', totalChunks: 8 };
    },
    async searchKeyword() { return [evidence]; },
    async searchSemantic() { return []; },
  };
  const embedder: TextEmbedder = { identity, async embed() { return [vector]; } };
  for (const scores of [[], [Number.NaN]]) {
    const invalidReranker: EvidenceReranker = { identity: reranker.identity, async score() { return scores; } };
    await assert.rejects(new RetrievalService(index, embedder, invalidReranker, planner).retrieve('revision-old', 'Who entered?'),
      (error: unknown) => error instanceof AssessmentError && error.code === 'unavailable');
  }
});

test('executes the original and scoped queries against one pinned index and records the real search and ranking receipts', async () => {
  const owner = { ...evidence, id: 'directory.md:0:25', path: 'directory.md', content: 'Account p-04 belongs to Elias.', score: 0.6 };
  const queries = ['Who approved and who owns the login?', 'approval account audit', 'account p-04 owner'];
  const calls: string[] = [];
  const index: EvidenceIndex = {
    async expandContext(_indexId, ids) {
      return ids.map((id) => { const chunk = id === owner.id ? owner : evidence;
        return { id, path: chunk.path, content: chunk.content,
          startOffset: chunk.startOffset, endOffset: chunk.endOffset, seedChunkId: id }; });
    },
    async findIndex(revision) {
      return { id: 'pinned-index', sourceRevisionId: revision, embedding: identity, chunkerVersion: 'v1', totalChunks: 8 };
    },
    async searchKeyword(id, query) {
      assert.equal(id, 'pinned-index'); calls.push(`keyword:${query}`); return [evidence, owner];
    },
    async searchSemantic(id, input) { assert.equal(id, 'pinned-index'); assert.deepEqual(input, vector); return [owner, evidence]; },
  };
  const embeddingCalls: string[][] = [];
  const embedder: TextEmbedder = { identity, async embed(inputs) { embeddingCalls.push([...inputs]); return inputs.map(() => vector); } };
  const planner: QuestionPlanner = { async plan() {
    return { queries: queries.slice(1), provider: 'groq', model: 'actual-model', promptVersion: 'planner-v1' };
  } };
  const reranker: EvidenceReranker = { identity: { model: 'reranker', revision: 'pinned', dtype: 'q8' },
    async score(query, chunks) { return chunks.map((chunk) => (query.includes('owner') ? chunk.id === owner.id : chunk.id === evidence.id) ? 8 : -4); } };
  const result = await new RetrievalService(index, embedder, reranker, planner).retrieve('revision-old', queries[0]!);
  assert.deepEqual(embeddingCalls, [[queries[0]], queries.slice(1)]);
  assert.deepEqual(calls, queries.map((query) => `keyword:${query}`));
  assert.deepEqual(result.searches.map((search) => search.query), queries);
  assert.deepEqual(result.reranks.map((rerank) => rerank.query), [queries[1], queries[2], queries[0]]);
  assert.deepEqual(result.context.map((chunk) => chunk.path), [evidence.path, owner.path]);
  assert(result.searches.every((receipt) => Date.parse(receipt.startedAt) <= Date.parse(receipt.completedAt)));
  assert.equal(result.reranks[0]?.scores[0]?.score, 8);
  assert.equal(result.reranks[0]?.scores[0]?.rank, 1);
});
