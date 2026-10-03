import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { AssessmentModel } from '../src/adapters/outbound/ai/assessment.model.js';
import { LocalTextEmbedder } from '../src/adapters/outbound/ai/text.embedder.js';
import { LocalEvidenceReranker } from '../src/adapters/outbound/ai/evidence.reranker.js';
import { QueryPlanner } from '../src/adapters/outbound/ai/query.planner.js';
import { Database } from '../src/adapters/outbound/postgres/database.js';
import { PostgresEvidenceIndex } from '../src/adapters/outbound/postgres/evidence.index.js';
import { RetrievalService } from '../src/application/retrieval.service.js';
import { promptVersion } from '../src/application/assessment.prompt.js';
import { validateAssessmentDraft } from '../src/domain/assessment.js';
import type { ModelEvent } from '../src/application/ports/assessment-generator.js';
import { readMysteryCases } from './mystery-cases.js';

const database = new Database();
const embedder = new LocalTextEmbedder();
const reranker = new LocalEvidenceReranker();
const retrieval = new RetrievalService(new PostgresEvidenceIndex(database), embedder, reranker, new QueryPlanner());
const model = new AssessmentModel();
const results = [];
try {
  const { rows } = await database.pool.query<{ revision_id: string }>("SELECT revision_id FROM source_collections WHERE id = 'last-broadcast'");
  const sourceRevisionId = rows[0]?.revision_id;
  if (!sourceRevisionId) throw new Error('Seed the mystery archive before evaluating answers');
  const labels = await readMysteryCases(database, sourceRevisionId);
  for (const [position, item] of labels.entries()) {
    // Space live requests within the small-model free allowance; never multiply accounts or keys.
    if (position > 0) await setTimeout(25_000);
    const evidence = await retrieval.retrieve(sourceRevisionId, item.question, 'hybrid');
    const attempts: ModelEvent[] = [];
    try {
      const draft = await model.generate(item.question, evidence.context, async (event) => { attempts.push(event); });
      const answer = validateAssessmentDraft(draft, evidence.context);
      const cited = new Set([...answer.basis, ...answer.notProof].map((quote) => quote.path));
      const missingPaths = [...new Set(item.passages.map((passage) => passage.path))].filter((path) => !cited.has(path));
      const passed = answer.verdict === item.expectedVerdict && missingPaths.length === 0;
      results.push({ id: item.id, question: item.question, expectedVerdict: item.expectedVerdict,
        passed, missingPaths, answer, attempts, queryPlan: evidence.queryPlan,
        reranks: evidence.reranks, contextIds: evidence.context.map((chunk) => chunk.id) });
      console.log(`${passed ? 'PASS' : 'FAIL'} ${item.id}: ${answer.verdict}, expected ${item.expectedVerdict}; missing citation paths: ${missingPaths.join(', ') || 'none'}`);
    } catch (error) {
      results.push({ id: item.id, question: item.question, expectedVerdict: item.expectedVerdict,
        passed: false, failure: error instanceof Error ? error.message : 'Answer evaluation failed',
        attempts, queryPlan: evidence.queryPlan, reranks: evidence.reranks });
      console.log(`FAIL ${item.id}: no validated answer`);
    }
  }
  const report = { checkedAt: new Date().toISOString(), sourceRevisionId, promptVersion,
    embedding: embedder.identity, reranker: reranker.identity,
    cases: results.length, passed: results.filter((item) => item.passed).length,
    limits: 'Exact quotes and required source paths do not prove semantic entailment. Review explanations against the evidence.', results };
  const output = process.env.ANSWER_EVALUATION_OUTPUT;
  if (output) await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cases: report.cases, passed: report.passed, promptVersion }));
  if (report.passed !== report.cases) process.exitCode = 1;
} finally {
  try { await Promise.all([embedder.dispose(), reranker.dispose()]); }
  finally { await database.onModuleDestroy(); }
}
