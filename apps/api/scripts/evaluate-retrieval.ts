import { readFile, readdir } from 'node:fs/promises';
import { Database } from '../src/database.js';
import { RunsRepository } from '../src/runs.repository.js';

type Evaluation = {
  id: string;
  question: string;
  relevantPaths: string[];
};

function isEvaluation(value: unknown): value is Evaluation {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'question' in value &&
    typeof value.question === 'string' &&
    'relevantPaths' in value &&
    Array.isArray(value.relevantPaths) &&
    value.relevantPaths.length > 0 &&
    value.relevantPaths.every((path: unknown) => typeof path === 'string')
  );
}

const fixtureDir = new URL('../../../fixtures/evaluations/', import.meta.url);
const filenames = (await readdir(fixtureDir)).filter((name) => name.endsWith('.json')).sort();
if (filenames.length === 0) {
  throw new Error('No retrieval evaluation cases found');
}

const database = new Database();
const runs = new RunsRepository(database);

try {
  const revisionId = await runs.findActiveSourceRevision();
  if (!revisionId) {
    throw new Error('Seed source documents before evaluating retrieval');
  }

  let found = 0;
  let expected = 0;
  console.log(`Keyword retrieval against ${revisionId}`);
  for (const filename of filenames) {
    const value: unknown = JSON.parse(await readFile(new URL(filename, fixtureDir), 'utf8'));
    if (!isEvaluation(value)) {
      throw new Error(`Invalid retrieval evaluation case: ${filename}`);
    }

    const candidates = await runs.searchKeyword(revisionId, value.question);
    const ranks = value.relevantPaths.map((path) => {
      const index = candidates.findIndex((candidate) => candidate.path === path);
      return { path, rank: index + 1 };
    });
    const hits = ranks.filter(({ rank }) => rank > 0).length;
    found += hits;
    expected += value.relevantPaths.length;
    const positions = ranks.map(({ path, rank }) => `${path}: ${rank === 0 ? 'missing' : `#${rank}`}`);
    console.log(`${value.id}: ${hits}/${value.relevantPaths.length} relevant at five (${positions.join(', ')})`);
  }

  console.log(`Keyword recall@5: ${found}/${expected}`);
  if (found !== expected) {
    process.exitCode = 1;
  }
} finally {
  await database.onModuleDestroy();
}
