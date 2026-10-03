import { readMysteryCases } from './mystery-cases.js';
import { QueryPlanner } from '../src/adapters/outbound/ai/query.planner.js';
import { LocalEvidenceReranker } from '../src/adapters/outbound/ai/evidence.reranker.js';
import { LocalTextEmbedder } from '../src/adapters/outbound/ai/text.embedder.js';
import { Database } from '../src/adapters/outbound/postgres/database.js';
import { PostgresEvidenceIndex } from '../src/adapters/outbound/postgres/evidence.index.js';
import { RetrievalService } from '../src/application/retrieval.service.js';

const database = new Database();
const embedder = new LocalTextEmbedder();
const index = new PostgresEvidenceIndex(database);
const reranker = new LocalEvidenceReranker();
const retrieval = new RetrievalService(index, embedder, reranker, new QueryPlanner());
try {
  const { rows } = await database.pool.query<{ revision_id: string }>(
    "SELECT revision_id FROM source_collections WHERE id = 'last-broadcast'");
  const revision = rows[0]?.revision_id;
  if (!revision) throw new Error('Seed the mystery collection before evaluating retrieval');
  const input = await readMysteryCases(database, revision);
  let expected = 0;
  const totals = { keyword: 0, hybrid: 0 };
  const reciprocalRanks = { keyword: 0, hybrid: 0 };
  const started = performance.now();
  const plans: { id: string; queries: string[]; durationMs: number }[] = [];
  console.log(`Passage retrieval evaluation: ${revision}; ${input.length} independently labeled questions`);
  for (const item of input) {
    expected += item.passages.length;
    for (const mode of ['keyword', 'hybrid'] as const) {
      const result = await retrieval.retrieve(revision, item.question, mode);
      if (result.queryPlan) plans.push({ id: item.id, queries: result.queryPlan.queries,
        durationMs: Date.parse(result.queryPlan.completedAt) - Date.parse(result.queryPlan.startedAt) });
      const ranks = item.passages.map((passage) => result.context.findIndex((chunk) =>
        chunk.path === passage.path && chunk.content.includes(passage.quote)) + 1);
      const found = ranks.filter((rank) => rank > 0).length;
      totals[mode] += found;
      const first = Math.min(...ranks.filter((rank) => rank > 0));
      reciprocalRanks[mode] += Number.isFinite(first) ? 1 / first : 0;
      console.log(`${item.id} / ${mode}: ${found}/${item.passages.length} passages in context; ranks ${ranks.join(', ')}`);
    }
    if (item !== input.at(-1)) await new Promise<void>((resolve) => setTimeout(resolve, 15_000));
  }
  console.log(JSON.stringify({
    sourceRevisionId: revision, embedding: embedder.identity, cases: input.length, expectedPassages: expected,
    keyword: { found: totals.keyword, recallAt5: totals.keyword / expected, mrrAt5: reciprocalRanks.keyword / input.length },
    hybrid: { found: totals.hybrid, recallAt5: totals.hybrid / expected, mrrAt5: reciprocalRanks.hybrid / input.length },
    reranker: reranker.identity, queryPlans: plans,
    durationMs: Math.round(performance.now() - started),
  }));
  if (totals.hybrid !== expected) process.exitCode = 1;
} finally {
  try { await Promise.all([embedder.dispose(), reranker.dispose()]); }
  finally { await database.onModuleDestroy(); }
}
