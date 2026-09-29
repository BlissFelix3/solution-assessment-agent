import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
  await client.query('BEGIN');
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('solution-assessment-migrations')::bigint)",
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrations = [
    [1, '001_initial.sql'],
    [2, '002_immutable_sources.sql'],
  ] as const;
  for (const [version, filename] of migrations) {
    const applied = await client.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [version],
    );
    if (applied.rows.length === 0) {
      const sql = await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    }
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
