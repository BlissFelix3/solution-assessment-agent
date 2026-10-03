import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkDocument, contextWindow, selectWindows, fuseChunks, fuseSearches, interleaveReranks, rerankChunks, maxChunkCharacters, type ScoredChunk } from './retrieval.js';

test('keeps original text and offsets while splitting long evidence with overlapping context', () => {
  const content = '# Statement\n\n' + Array.from({ length: 80 }, (_, i) =>
    `Witness ${i} saw the courier enter the archive at 21:17. `).join('');
  const chunks = chunkDocument('statement.md', content);
  assert(chunks.length > 3);
  assert.equal(chunks[0]?.startOffset, 0);
  assert.equal(chunks.at(-1)?.endOffset, content.trimEnd().length);
  for (const [index, chunk] of chunks.entries()) {
    assert.equal(chunk.content, content.slice(chunk.startOffset, chunk.endOffset));
    assert(chunk.content.length <= maxChunkCharacters);
    assert(chunk.content.length > 0);
    if (index > 0) {
      assert(chunk.startOffset < chunks[index - 1]!.endOffset);
      assert(chunk.startOffset > chunks[index - 1]!.startOffset);
    }
  }
  assert.deepEqual(chunkDocument('statement.md', content), chunks);
});

test('preserves UTF-16 source positions without cutting an emoji surrogate pair', () => {
  const content = '🔑'.repeat(650);
  const chunks = chunkDocument('keys.md', content);
  assert(chunks.length >= 3);
  for (const chunk of chunks) {
    assert.equal(chunk.content, content.slice(chunk.startOffset, chunk.endOffset));
    assert.equal(chunk.content.length % 2, 0);
    assert.equal(chunk.startOffset % 2, 0);
    assert.equal(chunk.endOffset % 2, 0);
    assert.equal(chunk.content.replaceAll('🔑', ''), '');
  }
});

test('ignores empty evidence and preserves short source content', () => {
  assert.deepEqual(chunkDocument('empty.md', ' \n\t '), []);
  assert.deepEqual(chunkDocument('key.md', '  The spare key was sealed.\n'), [{
    id: 'key.md:2:27', path: 'key.md', content: 'The spare key was sealed.', startOffset: 2, endOffset: 27,
  }]);
});

function chunk(id: string, path = `${id}.md`, startOffset = 0): ScoredChunk {
  return { id, path, content: 'A'.repeat(300), startOffset, endOffset: startOffset + 300, score: 0.5 };
}

test('rank fusion promotes evidence found by both searches without mixing raw score scales', () => {
  const a = chunk('a');
  const b = chunk('b');
  const c = chunk('c');
  const candidates = fuseChunks([{ ...a, score: 10_000 }, b], [c, b]);
  assert.equal(candidates[0]?.id, 'b');
  assert.equal(candidates[0]?.lexicalRank, 2);
  assert.equal(candidates[0]?.semanticRank, 2);
  assert.equal(candidates[0]?.fusionScore, 2 / 62);
  assert.equal(candidates.find((item) => item.id === 'a')?.semanticRank, null);
  assert.equal(candidates.find((item) => item.id === 'c')?.lexicalRank, null);
});

test('context excludes duplicate spans and leaves space for evidence from other documents', () => {
  const candidates = fuseChunks([
    chunk('a', 'witness.md', 0), chunk('duplicate', 'witness.md', 30),
    chunk('b', 'witness.md', 400), chunk('c', 'witness.md', 800), chunk('d', 'access-log.md'),
  ], []);
  assert.deepEqual(candidates.filter((item) => item.selectedRank !== null).map((item) => item.id), ['a', 'b', 'd']);
  assert.equal(candidates.find((item) => item.id === 'duplicate')?.selection, 'overlap');
  assert.equal(candidates.find((item) => item.id === 'c')?.selection, 'document_limit');
});

test('context has a stable order and a maximum of five chunks', () => {
  const candidates = fuseChunks(Array.from({ length: 8 }, (_, i) => chunk(`source-${i}`)), []);
  assert.deepEqual(candidates.map((item) => item.selectedRank), [1, 2, 3, 4, 5, null, null, null]);
  assert(candidates.slice(5).every((item) => item.selection === 'context_limit'));
  assert.deepEqual(fuseChunks([], []), []);
});

test('actual reranking replaces context order while preserving fusion evidence and enforcing diversity', () => {
  const candidates = fuseChunks([
    chunk('a', 'access-log.md', 0), chunk('b', 'access-log.md', 350),
    chunk('door-sensor', 'access-log.md', 700), chunk('witness'),
  ], []);
  const reranked = rerankChunks(candidates, [-2, -4, 8, 1]);
  assert.deepEqual(reranked.filter((item) => item.selectedRank !== null).map((item) => item.id),
    ['door-sensor', 'witness', 'a']);
  assert.equal(reranked[0]?.fusionRank, 3);
  assert.equal(reranked[0]?.rerankRank, 1);
  assert.equal(reranked[0]?.rerankScore, 8);
  assert.equal(reranked[0]?.fusionScore, candidates[2]?.fusionScore);
  assert.equal(reranked.find((item) => item.id === 'b')?.selection, 'document_limit');
  assert.equal(candidates[2]?.selectedRank, null);
  assert.throws(() => rerankChunks(candidates, [1]), /one finite score/);
  assert.throws(() => rerankChunks(candidates, [1, 2, Number.NaN, 4]), /one finite score/);
});

test('multi-query pooling bounds candidates and retains evidence for each part of a compound question', () => {
  const searches = Array.from({ length: 4 }, (_, query) => ({
    keyword: Array.from({ length: 20 }, (_, position) => chunk(`q${query}-lex${position}`)),
    semantic: Array.from({ length: 20 }, (_, position) => chunk(`q${query}-sem${position}`)),
  }));
  const candidates = fuseSearches(searches);
  assert.equal(candidates.length, 40);
  for (let query = 0; query < 4; query += 1) {
    assert.equal(candidates.filter((candidate) => candidate.id.startsWith(`q${query}-`)).length, 10);
  }
});

test('multi-hop context gives distinct subquestions a slot and deduplicates shared evidence', () => {
  const candidates = fuseChunks([chunk('approval'), chunk('owner'), chunk('shared'), chunk('unknown-operator')], []);
  const approval = rerankChunks(candidates, [8, -2, 2, -4]);
  const ownership = rerankChunks(candidates, [-2, 8, 2, -4]);
  const operator = rerankChunks(candidates, [-2, -4, 2, 8]);
  const combined = interleaveReranks([approval, ownership, operator]);
  assert.deepEqual(combined.map((candidate) => candidate.id), ['approval', 'owner', 'unknown-operator', 'shared']);
  assert.deepEqual(combined.map((candidate) => candidate.selectedRank), [1, 2, 3, 4]);
  assert.equal(combined[1]?.rerankScore, 8);
});

test('expands an actual child within its source while preserving its identity and exact UTF-16 offsets', () => {
  const document = '🔑'.repeat(950);
  const seed = chunkDocument('statement.md', document)[1]!;
  const window = contextWindow(seed, document);
  assert.equal(window.seedChunkId, seed.id);
  assert.equal(window.content, document.slice(window.startOffset, window.endOffset));
  assert(window.content.length <= 1200);
  assert(window.startOffset <= seed.startOffset);
  assert(window.endOffset >= seed.endOffset);
  assert.equal(window.content.replaceAll('🔑', ''), '');
  assert.throws(() => contextWindow(seed, 'changed document'), /pinned source/);
});

test('deduplicates expanded spans before assigning final selected ranks and keeps the context budget', () => {
  const candidates = fuseChunks([chunk('first', 'audit.md', 0), chunk('second', 'audit.md', 310), chunk('other')], []);
  const windows = candidates.map((candidate) => contextWindow(candidate, 'A'.repeat(2000)));
  const selected = selectWindows(windows, candidates);
  assert.deepEqual(selected.map((window) => window.seedChunkId), ['first', 'other']);
  assert.deepEqual(candidates.map((candidate) => candidate.selectedRank), [1, null, 2]);
  assert.equal(candidates[1]?.selection, 'overlap');
  const bounded = fuseChunks(Array.from({ length: 10 }, (_, index) => chunk(`doc${index}`, undefined, 500)), []);
  const expanded = bounded.map((candidate) => contextWindow(candidate, 'A'.repeat(2000)));
  const context = selectWindows(expanded, bounded);
  assert.equal(context.length, 5);
  assert(context.reduce((size, window) => size + window.content.length, 0) <= 6000);
});
