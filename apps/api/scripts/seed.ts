import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from '../src/adapters/outbound/postgres/database.js';
import { PostgresEvidenceIndex } from '../src/adapters/outbound/postgres/evidence.index.js';
import { LocalTextEmbedder } from '../src/adapters/outbound/ai/text.embedder.js';
import { chunkDocument } from '../src/domain/retrieval.js';
import type { CollectionId } from '../src/domain/collections.js';

const collections: { id: CollectionId; directory: string }[] = [
  { id: 'northstar', directory: 'sources' },
  { id: 'last-broadcast', directory: 'last-broadcast' },
];
const database = new Database();
const index = new PostgresEvidenceIndex(database);
const embedder = new LocalTextEmbedder();

try {
  for (const collection of collections) {
    const sourceDir = fileURLToPath(new URL(`../../../fixtures/${collection.directory}/`, import.meta.url));
    const paths = (await readdir(sourceDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
    if (paths.length === 0) throw new Error('No source documents found');
    const documents = await Promise.all(paths.map(async (path) => ({
      path, content: await readFile(join(sourceDir, path), 'utf8'),
    })));
    const revisionId = `fixture:${createHash('sha256').update(JSON.stringify(documents)).digest('hex')}`;
    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO source_revisions (id, origin) VALUES ($1, 'fixture') ON CONFLICT DO NOTHING", [revisionId],
      );
      for (const document of documents) {
        await client.query(
          'INSERT INTO source_documents (revision_id, path, content) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [revisionId, document.path, document.content],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    let manifest = await index.findIndex(revisionId, embedder.identity);
    if (!manifest) {
      const chunks = documents.flatMap((document) => chunkDocument(document.path, document.content));
      const embedded = [];
      for (let offset = 0; offset < chunks.length; offset += 4) {
        const batch = chunks.slice(offset, offset + 4);
        const vectors = await embedder.embed(batch.map((chunk) => chunk.content));
        for (const [position, chunk] of batch.entries()) {
          const embedding = vectors[position];
          if (!embedding) throw new Error('A source chunk was not embedded');
          embedded.push({ ...chunk, embedding });
        }
      }
      manifest = await index.indexRevision(revisionId, documents, embedded, embedder.identity);
    }
    // Publish the collection only after its complete immutable evidence index exists.
    await database.pool.query(`
      INSERT INTO source_collections (id, revision_id) VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET revision_id = EXCLUDED.revision_id
    `, [collection.id, revisionId]);
    if (collection.id === 'northstar') {
      await database.pool.query(`
        INSERT INTO active_source_revision (singleton, revision_id) VALUES (true, $1)
        ON CONFLICT (singleton) DO NOTHING
      `, [revisionId]);
    }
    console.log(`${collection.id}: ${documents.length} documents, ${manifest.totalChunks} indexed chunks, ${revisionId}`);
  }
} finally {
  try {
    await embedder.dispose();
  } finally {
    await database.onModuleDestroy();
  }
}
