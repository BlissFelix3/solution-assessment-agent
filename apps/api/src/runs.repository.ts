import { Inject, Injectable } from '@nestjs/common';
import type { AssessmentToSave, NotProofQuote, SourceQuote } from './assessment.js';
import { Database } from './database.js';

type AssessmentRow = {
  run_id: string;
  question_id: string;
  verdict: AssessmentToSave['verdict'];
  explanation: string;
  basis: SourceQuote[];
  not_proof: NotProofQuote[];
  missing_evidence: string | null;
  created_at: Date;
};

function toAssessment(row: AssessmentRow) {
  return {
    runId: row.run_id,
    questionId: row.question_id,
    verdict: row.verdict,
    explanation: row.explanation,
    basis: row.basis,
    notProof: row.not_proof,
    missingEvidence: row.missing_evidence,
    createdAt: row.created_at,
  };
}

@Injectable()
export class RunsRepository {
  constructor(@Inject(Database) private readonly database: Database) {}

  async findActiveSourceRevision() {
    const { rows } = await this.database.pool.query<{ revision_id: string }>(
      'SELECT revision_id FROM active_source_revision WHERE singleton = true',
    );
    return rows[0]?.revision_id;
  }

  async create() {
    const { rows } = await this.database.pool.query<{
      id: string;
      source_revision_id: string;
    }>(`
      INSERT INTO assessment_runs (scenario, source_revision_id)
      SELECT 'northstar', revision_id
      FROM active_source_revision
      WHERE singleton = true
      RETURNING id, source_revision_id
    `);
    const run = rows[0];
    return run ? { id: run.id, sourceRevisionId: run.source_revision_id } : undefined;
  }

  async findSourceRevision(id: string) {
    const { rows } = await this.database.pool.query<{ source_revision_id: string }>(
      'SELECT source_revision_id FROM assessment_runs WHERE id = $1',
      [id],
    );
    return rows[0]?.source_revision_id;
  }

  async searchKeyword(sourceRevisionId: string, question: string) {
    const { rows } = await this.database.pool.query<{
      path: string;
      content: string;
      score: number;
    }>(`
      WITH query AS (
        SELECT string_agg(quote_literal(lexeme), ' | ' ORDER BY lexeme)::tsquery AS terms
        FROM unnest(tsvector_to_array(to_tsvector('english', $2))) AS lexeme
      )
      SELECT d.path, d.content,
             ts_rank_cd(to_tsvector('english', d.content), query.terms) AS score
      FROM source_documents AS d CROSS JOIN query
      WHERE d.revision_id = $1
        AND to_tsvector('english', d.content) @@ query.terms
      ORDER BY score DESC, d.path
      LIMIT 5
    `, [sourceRevisionId, question]);
    return rows;
  }

  async findAssessment(runId: string, questionId: string) {
    const { rows } = await this.database.pool.query<AssessmentRow>(
      'SELECT * FROM requirement_assessments WHERE run_id = $1 AND question_id = $2',
      [runId, questionId],
    );
    return rows[0] ? toAssessment(rows[0]) : undefined;
  }

  async listAssessments(runId: string) {
    const { rows } = await this.database.pool.query<AssessmentRow>(
      'SELECT * FROM requirement_assessments WHERE run_id = $1 ORDER BY question_id',
      [runId],
    );
    return rows.map(toAssessment);
  }

  async findSource(sourceRevisionId: string, path: string) {
    const { rows } = await this.database.pool.query<{ path: string; content: string }>(
      'SELECT path, content FROM source_documents WHERE revision_id = $1 AND path = $2',
      [sourceRevisionId, path],
    );
    return rows[0];
  }

  async saveOrGetAssessment(assessment: AssessmentToSave) {
    const { rows } = await this.database.pool.query<AssessmentRow>(`
      INSERT INTO requirement_assessments
        (run_id, question_id, verdict, explanation, basis, not_proof, missing_evidence)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
      ON CONFLICT (run_id, question_id) DO NOTHING
      RETURNING *
    `, [
      assessment.runId,
      assessment.questionId,
      assessment.verdict,
      assessment.explanation,
      JSON.stringify(assessment.basis),
      JSON.stringify(assessment.notProof),
      assessment.missingEvidence,
    ]);
    if (rows[0]) {
      return toAssessment(rows[0]);
    }

    // A conflicting row may be invisible to the INSERT snapshot; this query gets a new one.
    const existing = await this.findAssessment(assessment.runId, assessment.questionId);
    if (!existing) {
      throw new Error('Assessment disappeared after insert conflict');
    }
    return existing;
  }
}
