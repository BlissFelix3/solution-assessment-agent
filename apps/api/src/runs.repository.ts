import { Inject, Injectable } from '@nestjs/common';
import { Database } from './database.js';

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

}
