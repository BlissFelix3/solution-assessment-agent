import { Inject, Injectable } from '@nestjs/common';
import type { AssessmentToSave, NotProofQuote, SourceQuote } from '../../../domain/assessment.js';
import { Database } from './database.js';
import type { ImplementationStep } from '../../../domain/implementation-path.js';
import { preparedRequirements, type Requirement } from '../../../domain/requirements.js';
import type { RunEvent } from '../../../domain/run-trace.js';

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

type RunRow = {
  requirements: Requirement[];
  n8n_execution_id: string | null;
  source_revision_id: string;
  status: 'pending' | 'completed' | 'failed';
  created_at: Date;
  implementation_path: ImplementationStep[] | null;
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

  async create(executionId: string, requirements: Requirement[] = preparedRequirements) {
    const { rows } = await this.database.pool.query<{
      id: string;
      source_revision_id: string;
    }>(
      `
      WITH created AS (
        INSERT INTO assessment_runs (scenario, source_revision_id, n8n_execution_id, requirements)
        SELECT 'northstar', revision_id, $1, $2::jsonb
        FROM active_source_revision
        WHERE singleton = true
        RETURNING id, source_revision_id
      ), recorded AS (
        INSERT INTO run_events (run_id, stage, status, data)
        SELECT id, 'workflow', 'succeeded', jsonb_build_object(
          'requirements', $2::jsonb, 'executionId', $1::text, 'scenario', 'northstar', 'sourceRevisionId', source_revision_id
        ) FROM created
      )
      SELECT id, source_revision_id FROM created
    `,
      [executionId, JSON.stringify(requirements)],
    );
    const run = rows[0];
    return run ? { id: run.id, sourceRevisionId: run.source_revision_id, requirements } : undefined;
  }

  async admitDemoStart(maxPerHour: number) {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('solution-assessment-demo-starts')::bigint)");
      const result = await client.query(`
        INSERT INTO demo_start_admissions (admitted_at)
        SELECT now()
        WHERE (
          SELECT count(*) FROM demo_start_admissions
          WHERE admitted_at >= now() - interval '1 hour'
        ) < $1
        RETURNING id
      `, [maxPerHour]);
      await client.query('COMMIT');
      return result.rowCount === 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findRun(id: string) {
    const { rows } = await this.database.pool.query<RunRow>(
      'SELECT requirements, n8n_execution_id, source_revision_id, status, created_at, implementation_path FROM assessment_runs WHERE id = $1',
      [id],
    );
    const run = rows[0];
    return run
      ? {
          requirements: run.requirements,
          executionId: run.n8n_execution_id,
          sourceRevisionId: run.source_revision_id,
          status: run.status,
          createdAt: run.created_at,
          implementationPath: run.implementation_path,
        }
      : undefined;
  }

  async saveImplementationPath(id: string, path: ImplementationStep[]) {
    const { rows } = await this.database.pool.query<{ implementation_path: ImplementationStep[] }>(
      `
      WITH saved AS (
        UPDATE assessment_runs
        SET implementation_path = $2::jsonb
        WHERE id = $1 AND status = 'pending' AND implementation_path IS NULL
          AND (SELECT count(*) FROM requirement_assessments WHERE run_id = $1) = jsonb_array_length(requirements)
        RETURNING id, implementation_path
      ), recorded AS (
        INSERT INTO run_events (run_id, stage, status, data)
        SELECT id, 'dossier', 'succeeded', jsonb_build_object('implementationPath', implementation_path)
        FROM saved
      )
      SELECT implementation_path FROM saved
    `,
      [id, JSON.stringify(path)],
    );
    if (rows[0]) {
      return rows[0].implementation_path;
    }
    return (await this.findRun(id))?.implementationPath;
  }

  async complete(id: string) {
    const result = await this.database.pool.query(
      `
      WITH completed AS (
        UPDATE assessment_runs
        SET status = 'completed'
        WHERE id = $1 AND status = 'pending'
          AND implementation_path IS NOT NULL
          AND (SELECT count(*) FROM requirement_assessments WHERE run_id = $1) = jsonb_array_length(requirements)
        RETURNING id, requirements
      ), recorded AS (
        INSERT INTO run_events (run_id, stage, status, data)
        SELECT id, 'completion', 'succeeded', jsonb_build_object('assessmentCount', jsonb_array_length(requirements)) FROM completed
      )
      SELECT id FROM completed
    `,
      [id],
    );
    return result.rowCount === 1 || (await this.findRun(id))?.status === 'completed';
  }

  async failExecution(executionId: string) {
    await this.database.pool.query(`
      WITH failed AS (
        UPDATE assessment_runs
        SET status = 'failed'
        WHERE n8n_execution_id = $1 AND status = 'pending'
        RETURNING id
      )
      INSERT INTO run_events (run_id, stage, status, data)
      SELECT id, 'workflow', 'failed', '{"reason":"Workflow reported a failure"}'::jsonb
      FROM failed
    `, [executionId]);
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

  async saveOrGetAssessment(assessment: AssessmentToSave, attemptId: string) {
    const { rows } = await this.database.pool.query<AssessmentRow>(`
      WITH saved AS (
        INSERT INTO requirement_assessments
          (run_id, question_id, verdict, explanation, basis, not_proof, missing_evidence)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
        ON CONFLICT (run_id, question_id) DO NOTHING
        RETURNING *
      ), recorded AS (
        INSERT INTO run_events (run_id, question_id, attempt_id, stage, status, data)
        SELECT run_id, question_id, $8, 'persistence', 'succeeded',
          jsonb_build_object('assessment', $9::jsonb, 'reused', false)
        FROM saved
      )
      SELECT * FROM saved
    `, [
      assessment.runId,
      assessment.questionId,
      assessment.verdict,
      assessment.explanation,
      JSON.stringify(assessment.basis),
      JSON.stringify(assessment.notProof),
      assessment.missingEvidence,
      attemptId,
      JSON.stringify(assessment),
    ]);
    if (rows[0]) {
      return toAssessment(rows[0]);
    }

    // A conflicting row may be invisible to the INSERT snapshot; this query gets a new one.
    const existing = await this.findAssessment(assessment.runId, assessment.questionId);
    if (!existing) {
      throw new Error('Assessment disappeared after insert conflict');
    }
    await this.appendEvent(assessment.runId, {
      stage: 'persistence', status: 'succeeded', questionId: assessment.questionId, attemptId,
      data: { assessment: existing, reused: true },
    });
    return existing;
  }

  async appendEvent(runId: string, event: RunEvent) {
    await this.database.pool.query(`
      INSERT INTO run_events (run_id, stage, status, question_id, attempt_id, data)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `, [runId, event.stage, event.status, event.questionId, event.attemptId, JSON.stringify(event.data)]);
  }

  async listEvents(runId: string) {
    const { rows } = await this.database.pool.query<{
      id: string;
      stage: RunEvent['stage'];
      status: RunEvent['status'];
      question_id: string | null;
      attempt_id: string | null;
      created_at: Date;
      data: Record<string, unknown>;
    }>('SELECT * FROM run_events WHERE run_id = $1 ORDER BY id', [runId]);
    return rows.map((row) => ({
      id: row.id,
      stage: row.stage,
      status: row.status,
      questionId: row.question_id,
      attemptId: row.attempt_id,
      createdAt: row.created_at,
      data: row.data,
    }));
  }
}
