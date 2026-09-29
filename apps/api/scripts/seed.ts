import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const sourceDir = fileURLToPath(new URL('../../../fixtures/sources/', import.meta.url));
const paths = (await readdir(sourceDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name)
  .sort();
if (paths.length === 0) {
  throw new Error('No fixture source documents found');
}

const documents = await Promise.all(
  paths.map(async (path) => ({ path, content: await readFile(join(sourceDir, path), 'utf8') })),
);
const revisionId = `fixture:${createHash('sha256').update(JSON.stringify(documents)).digest('hex')}`;
const client = new pg.Client({ connectionString });
await client.connect();

try {
  await client.query('BEGIN');
  await client.query(
    "INSERT INTO source_revisions (id, origin) VALUES ($1, 'fixture') ON CONFLICT DO NOTHING",
    [revisionId],
  );
  for (const document of documents) {
    await client.query(
      'INSERT INTO source_documents (revision_id, path, content) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [revisionId, document.path, document.content],
    );
  }

  const stored = await client.query<{ path: string; content: string }>(
    'SELECT path, content FROM source_documents WHERE revision_id = $1',
    [revisionId],
  );
  const storedContent = new Map(stored.rows.map((row) => [row.path, row.content]));
  if (
    stored.rows.length !== documents.length ||
    documents.some((document) => storedContent.get(document.path) !== document.content)
  ) {
    throw new Error('Stored fixture revision does not match fixture files');
  }

  const published = await client.query(
    'INSERT INTO active_source_revision (singleton, revision_id) VALUES (true, $1) ON CONFLICT (singleton) DO NOTHING RETURNING revision_id',
    [revisionId],
  );
  await client.query('COMMIT');
  console.log(
    published.rows.length === 1
      ? `Activated fixture revision ${revisionId}`
      : `Active revision unchanged; fixture revision ${revisionId} stored`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
