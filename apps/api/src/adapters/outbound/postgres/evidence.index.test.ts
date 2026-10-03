import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { chunkDocument, chunkerVersion, type EmbeddingIdentity } from '../../../domain/retrieval.js';
import { Database } from './database.js';
import { PostgresEvidenceIndex } from './evidence.index.js';

const identity: EmbeddingIdentity = { model: 'test-unit-encoder', revision: 'v1', dimensions: 384, dtype: 'q8' };
const direction = (x: number, y = 0) => [x, y, ...Array<number>(382).fill(0)];

test('a chunk insert waiting on publication cannot append evidence after the index is sealed', {
  skip: !process.env.TEST_DATABASE_URL,
}, async (t) => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const database = new Database();
  const publisher = await database.pool.connect();
  const lateWriter = await database.pool.connect();
  t.after(async () => {
    await publisher.query('ROLLBACK');
    publisher.release(); lateWriter.release();
    await database.onModuleDestroy();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  });
  const revision = `test-sealing:${randomUUID()}`;
  const id = `index:${revision}`;
  await database.pool.query("INSERT INTO source_revisions (id, origin) VALUES ($1, 'fixture')", [revision]);
  await database.pool.query("INSERT INTO source_documents (revision_id, path, content) VALUES ($1, 'a.md', 'Courier entered.')", [revision]);
  await publisher.query('BEGIN');
  await publisher.query(`
    INSERT INTO source_chunks (index_id, revision_id, id, path, start_offset, end_offset, content, embedding)
    VALUES ($1, $2, 'initial', 'a.md', 0, 16, 'Courier entered.', $3::real[])
  `, [id, revision, direction(1)]);
  await publisher.query(`
    INSERT INTO source_indexes (id, revision_id, embedding_model, embedding_revision,
      embedding_dimensions, embedding_dtype, chunker_version, chunk_count)
    VALUES ($1, $2, 'test-sealing', 'v1', 384, 'q8', $3, 1)
  `, [id, revision, chunkerVersion]);
  const pid = (await lateWriter.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
  const attempt = lateWriter.query(`
    INSERT INTO source_chunks (index_id, revision_id, id, path, start_offset, end_offset, content, embedding)
    VALUES ($1, $2, 'late', 'a.md', 0, 7, 'Courier', $3::real[])
  `, [id, revision, direction(1)]).then(() => null, (error: unknown) => error);
  let waiting = false;
  for (let tries = 0; tries < 100 && !waiting; tries += 1) {
    const locks = await database.pool.query<{ waiting: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted) AS waiting
    `, [pid]);
    waiting = locks.rows[0]!.waiting;
    if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert(waiting, 'The late insert must be observed waiting on the publication lock');
  await publisher.query('COMMIT');
  const error = await attempt;
  assert(error instanceof Error);
  assert.match(error.message, /Published evidence indexes are immutable/);
  const count = await database.pool.query<{ count: string }>('SELECT count(*) FROM source_chunks WHERE index_id = $1', [id]);
  assert.equal(count.rows[0]?.count, '1');
});

test('publishes one sealed revision index under concurrent seeds and computes exact cosine independently', {
  skip: !process.env.TEST_DATABASE_URL,
}, async (t) => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const database = new Database();
  t.after(async () => {
    await database.onModuleDestroy();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  });
  const index = new PostgresEvidenceIndex(database);
  const revision = `test-index:${randomUUID()}`;
  const documents = [
    { path: 'a.md', content: 'Courier entered the archive after closing.' },
    { path: 'b.md', content: 'Reception desk logged the visitor badge.' },
    { path: 'c.md', content: 'Gardener watered the flowers.' },
  ];
  await database.pool.query("INSERT INTO source_revisions (id, origin) VALUES ($1, 'fixture')", [revision]);
  for (const doc of documents) {
    await database.pool.query('INSERT INTO source_documents (revision_id, path, content) VALUES ($1, $2, $3)',
      [revision, doc.path, doc.content]);
  }
  const vectors = [direction(1), direction(0, 1), direction(-1)];
  const embedded = documents.flatMap((doc, position) =>
    chunkDocument(doc.path, doc.content).map((chunk) => ({ ...chunk, embedding: vectors[position]! })));
  const published = await Promise.all(Array.from({ length: 4 }, () =>
    index.indexRevision(revision, documents, embedded, identity)));
  assert(published.every((manifest) => manifest.id === published[0]!.id));
  const manifest = published[0]!;
  assert.equal(manifest.totalChunks, 3);
  assert.deepEqual(await index.findIndex(revision, identity), manifest);
  assert.equal(await index.findIndex('different-revision', identity), undefined);
  assert.equal(await index.findIndex(revision, { ...identity, revision: 'different-model-revision' }), undefined);
  const rows = await database.pool.query<{ count: string }>('SELECT count(*) FROM source_chunks WHERE index_id = $1', [manifest.id]);
  assert.equal(rows.rows[0]?.count, '3');

  const semantic = await index.searchSemantic(manifest.id, direction(1), 20);
  assert.deepEqual(semantic.map((chunk) => [chunk.path, chunk.score]), [['a.md', 1], ['b.md', 0], ['c.md', -1]]);
  assert.deepEqual((await index.searchKeyword(manifest.id, 'visitor badge', 20)).map((chunk) => chunk.path), ['b.md']);
  assert.deepEqual(await index.searchKeyword(manifest.id, 'the and', 20), []);
  assert.deepEqual(await index.searchSemantic('missing-index', direction(1), 20), []);
  const windows = await index.expandContext(manifest.id, [semantic[1]!.id, semantic[0]!.id]);
  assert.deepEqual(windows.map((window) => [window.path, window.seedChunkId, window.content]), [
    ['b.md', semantic[1]!.id, documents[1]!.content], ['a.md', semantic[0]!.id, documents[0]!.content],
  ]);
  await assert.rejects(index.expandContext('different-index', [semantic[0]!.id]), /absent from the pinned index/);
  await assert.rejects(index.expandContext(manifest.id, [semantic[0]!.id, semantic[0]!.id]), /distinct indexed chunks/);
  await assert.rejects(index.searchSemantic(manifest.id, direction(Number.NaN), 20), /finite nonzero/);

  await assert.rejects(database.pool.query('UPDATE source_chunks SET content = $1 WHERE index_id = $2',
    ['Invented evidence.', manifest.id]), /immutable/);
  await assert.rejects(database.pool.query('DELETE FROM source_indexes WHERE id = $1', [manifest.id]), /immutable/);
  await assert.rejects(database.pool.query(`
    INSERT INTO source_chunks (index_id, revision_id, id, path, start_offset, end_offset, content, embedding)
    VALUES ($1, $2, 'extra-chunk', 'a.md', 0, 7, 'Courier', $3::real[])
  `, [manifest.id, revision, direction(1)]), /Published evidence indexes are immutable/);

  await assert.rejects(database.pool.query(`
    INSERT INTO source_indexes (id, revision_id, embedding_model, embedding_revision,
      embedding_dimensions, embedding_dtype, chunker_version, chunk_count)
    VALUES ('incomplete-' || $1, $1, 'missing-chunks', 'v1', 384, 'q8', $2, 1)
  `, [revision, chunkerVersion]), /all declared chunks/);
  await assert.rejects(database.pool.query(`
    INSERT INTO source_chunks (index_id, revision_id, id, path, start_offset, end_offset, content, embedding)
    VALUES ('nonfinite-' || $1, $1, 'nonfinite', 'a.md', 0, 7, 'Courier', $2::real[])
  `, [revision, direction(Number.NaN)]), /source_chunks_embedding_check/);
  const invalidIdentity = { ...identity, revision: 'bad-vector' };
  await assert.rejects(index.indexRevision(revision, documents,
    embedded.map((chunk) => ({ ...chunk, embedding: direction(0) })), invalidIdentity), /finite nonzero/);
  assert.equal(await index.findIndex(revision, invalidIdentity), undefined);
});
