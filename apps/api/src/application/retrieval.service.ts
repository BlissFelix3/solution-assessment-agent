import type { EvidenceIndex } from './ports/evidence-index.js';
import type { TextEmbedder } from './ports/text-embedder.js';
import type { EvidenceReranker } from './ports/evidence-reranker.js';
import type { QuestionPlanner } from './ports/question-planner.js';
import { AssessmentError } from '../domain/errors.js';
import {
  contextCharacterLimit, contextLimit, fuseSearches, interleaveReranks, rerankChunks, selectWindows, retrievalCandidateLimit, rrfK,
  type RetrievalResult,
} from '../domain/retrieval.js';

export class RetrievalService {
  constructor(
    private readonly index: EvidenceIndex,
    private readonly embedder: TextEmbedder,
    private readonly reranker: EvidenceReranker,
    private readonly planner: QuestionPlanner,
  ) {}

  async retrieve(
    sourceRevisionId: string,
    question: string,
    mode: 'hybrid' | 'keyword' = 'hybrid',
  ): Promise<RetrievalResult> {
    const manifest = await this.index.findIndex(sourceRevisionId, this.embedder.identity);
    if (!manifest) {
      throw new AssessmentError('unavailable', 'Evidence index is not ready for this source revision');
    }
    const searches: RetrievalResult['searches'] = [];
    const search = async (query: string, vector: number[] | undefined) => {
      const startedAt = new Date().toISOString();
      const [keyword, semantic] = await Promise.all([
        this.index.searchKeyword(manifest.id, query, retrievalCandidateLimit),
        vector ? this.index.searchSemantic(manifest.id, vector, retrievalCandidateLimit) : [],
      ]);
      searches.push({ query, startedAt, completedAt: new Date().toISOString(), keyword, semantic });
    };
    const [initialVector] = mode === 'hybrid' ? await this.embedder.embed([question]) : [];
    if (mode === 'hybrid' && !initialVector) {
      throw new AssessmentError('unavailable', 'Query embedding did not finish');
    }
    await search(question, initialVector);
    let queryPlan: RetrievalResult['queryPlan'] = null;
    if (mode === 'hybrid') {
      const startedAt = new Date().toISOString();
      const initialEvidence = fuseSearches(searches).slice(0, 3);
      const planned = await this.planner.plan(question, initialEvidence);
      queryPlan = { ...planned, startedAt, completedAt: new Date().toISOString(), initialEvidence };
    }
    const queries = queryPlan?.queries.filter((query) => query !== question) ?? [];
    const vectors = queries.length > 0 ? await this.embedder.embed(queries) : [];
    if (vectors.length !== queries.length) {
      throw new AssessmentError('unavailable', 'Query embeddings did not finish');
    }
    for (const [position, query] of queries.entries()) {
      await search(query, vectors[position]);
    }
    let candidates = fuseSearches(searches);
    const reranks: RetrievalResult['reranks'] = [];
    let rerankDurationMs: number | null = null;
    if (mode === 'hybrid') {
      const started = performance.now();
      const rankings = [];
      for (const query of [...queries, question]) {
        const startedAt = new Date().toISOString();
        const scores = await this.reranker.score(query, candidates);
        if (scores.length !== candidates.length || !scores.every(Number.isFinite)) {
          throw new AssessmentError('unavailable', 'Evidence reranker returned invalid scores');
        }
        const ranked = rerankChunks(candidates, scores);
        reranks.push({ query, startedAt, completedAt: new Date().toISOString(),
          scores: ranked.map((chunk) => ({ chunkId: chunk.id, score: chunk.rerankScore!, rank: chunk.rerankRank! })) });
        rankings.push(ranked);
      }
      candidates = interleaveReranks(rankings);
      rerankDurationMs = Math.round(performance.now() - started);
    }
    const expanded = await this.index.expandContext(manifest.id, candidates.map((chunk) => chunk.id));
    const context = selectWindows(expanded, candidates);
    return {
      mode, sourceRevisionId, indexId: manifest.id, embedding: manifest.embedding,
      reranker: mode === 'hybrid' ? this.reranker.identity : null, rerankDurationMs,
      queryPlan, searches, reranks,
      chunkerVersion: manifest.chunkerVersion, totalChunks: manifest.totalChunks,
      candidateLimit: retrievalCandidateLimit, contextLimit, contextCharacterLimit, rrfK,
      candidates, context,
    };
  }
}
