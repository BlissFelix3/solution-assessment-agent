import { readFile } from 'node:fs/promises';
import { Database } from '../src/adapters/outbound/postgres/database.js';

export type MysteryCase = {
  id: string; question: string; expectedVerdict: 'supported' | 'unsupported' | 'unknown';
  passages: { path: string; quote: string }[];
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function mysteryCase(value: unknown): value is MysteryCase {
  return record(value) && typeof value.id === 'string' && typeof value.question === 'string' &&
    (value.expectedVerdict === 'supported' || value.expectedVerdict === 'unsupported' || value.expectedVerdict === 'unknown') &&
    Array.isArray(value.passages) && value.passages.length > 0 && value.passages.every((passage: unknown) =>
      record(passage) && typeof passage.path === 'string' && typeof passage.quote === 'string');
}

export async function readMysteryCases(database: Database, sourceRevisionId: string): Promise<MysteryCase[]> {
  const labels: unknown = JSON.parse(await readFile(new URL('../../../fixtures/mystery-evaluations.json', import.meta.url), 'utf8'));
  if (!Array.isArray(labels) || labels.length === 0 || !labels.every(mysteryCase)) throw new Error('Invalid mystery evaluation labels');
  // Labels come from corpus facts, not the retriever's output. Check them against the exact revision being evaluated.
  for (const item of labels) {
    for (const passage of item.passages) {
      const { rows } = await database.pool.query<{ content: string }>(
        'SELECT content FROM source_documents WHERE revision_id = $1 AND path = $2', [sourceRevisionId, passage.path]);
      if (!rows[0]?.content.includes(passage.quote)) throw new Error(`Evaluation quote is absent: ${item.id} / ${passage.path}`);
    }
  }
  return labels;
}
