import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceChunk } from '../../../domain/retrieval.js';
import { LocalEvidenceReranker } from './evidence.reranker.js';

function passage(content: string, index = 0): SourceChunk {
  return { id: `test-${index}`, path: `test-${index}.md`, content, startOffset: 0, endOffset: content.length };
}

test('rejects blank inputs and unbounded candidate batches before loading the reranker', async () => {
  const reranker = new LocalEvidenceReranker();
  assert.deepEqual(await reranker.score('Question', []), []);
  await assert.rejects(reranker.score(' ', [passage('Evidence')]), /nonblank question/);
  await assert.rejects(reranker.score('Question', [passage(' ')]), /nonblank passages/);
  await assert.rejects(reranker.score('Question', Array.from({ length: 41 }, () => passage('Evidence'))), /one to forty/);
  await reranker.dispose();
});

test('pinned cross-encoder matches the author reference, ranks relevance, and keeps order across batches', {
  skip: process.env.TEST_EMBEDDING_MODEL !== '1',
}, async (t) => {
  const reranker = new LocalEvidenceReranker();
  t.after(() => reranker.dispose());
  const berlin = passage('Berlin has a population of 3,520,031 registered inhabitants in an area of 891.82 square kilometers.');
  const newYork = passage('New York City is famous for the Metropolitan Museum of Art.');
  const question = 'How many people live in Berlin?';
  const scores = await reranker.score(question, [berlin, newYork, berlin, newYork, berlin]);
  assert.equal(scores.length, 5);
  // Published q8 reference: https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2
  assert(Math.abs(scores[0]! - 8.663132667541504) < 0.05);
  assert(Math.abs(scores[1]! - -11.245542526245117) < 0.05);
  assert(scores[0]! > scores[1]! + 10);
  assert(Math.abs(scores[0]! - scores[4]!) < 0.1);
  await assert.rejects(reranker.score('key '.repeat(510), [berlin]), /512-token pair budget/);
});
