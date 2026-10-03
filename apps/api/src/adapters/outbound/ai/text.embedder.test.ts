import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalTextEmbedder } from './text.embedder.js';

test('rejects empty texts and oversized embedding batches before loading a model', async () => {
  const embedder = new LocalTextEmbedder();
  assert.deepEqual(await embedder.embed([]), []);
  await assert.rejects(embedder.embed([' ']), /nonblank texts/);
  await assert.rejects(embedder.embed(Array<string>(5).fill('Evidence')), /one to four/);
  await embedder.dispose();
});

test('local pinned MiniLM embeds paraphrases with normalized vectors and preserves batch padding', {
  skip: process.env.TEST_EMBEDDING_MODEL !== '1',
}, async (t) => {
  const embedder = new LocalTextEmbedder();
  t.after(() => embedder.dispose());
  const texts = [
    'The emergency access credential was copied after hours.',
    'Someone duplicated the backup key at night.',
    'The delivery log refreshes every 60 seconds.',
  ];
  const vectors = await embedder.embed(texts);
  assert.equal(vectors.length, 3);
  for (const vector of vectors) {
    assert.equal(vector.length, 384);
    assert(vector.every(Number.isFinite));
    assert(Math.abs(vector.reduce((total, value) => total + value * value, 0) - 1) < 1e-6);
  }
  const cosine = (other: number[]) => vectors[0]!.reduce((sum, value, index) => sum + value * other[index]!, 0);
  assert(cosine(vectors[1]!) > cosine(vectors[2]!) + 0.1);
  const [alone] = await embedder.embed([texts[1]!]);
  assert(alone);
  assert(vectors[1]!.every((value, index) => Math.abs(value - alone[index]!) < 0.02));
  await assert.rejects(embedder.embed(['key '.repeat(300)]), /256-token budget/);
});
