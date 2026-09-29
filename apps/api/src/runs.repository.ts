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

}
