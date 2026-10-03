import { createHash } from 'node:crypto';
import type { EvidenceIndex } from '../../../application/ports/evidence-index.js';
import {
  chunkDocument, chunkerVersion, contextWindow,
  type EmbeddingIdentity, type EvidenceIndexManifest, type ScoredChunk, type SourceChunk,
} from '../../../domain/retrieval.js';
import { Database } from './database.js';

type ManifestRow = {
  id: string;
  revision_id: string;
  embedding_model: string;
  embedding_revision: string;
  embedding_dimensions: number;
  embedding_dtype: 'q8';
  chunker_version: string;
  chunk_count: number;
};

type ChunkRow = {
  id: string;
  path: string;
  content: string;
  start_offset: number;
  end_offset: number;
  score: number;
};

function manifest(row: ManifestRow): EvidenceIndexManifest {
  return {
    id: row.id, sourceRevisionId: row.revision_id,
    embedding: {
      model: row.embedding_model, revision: row.embedding_revision,
      dimensions: row.embedding_dimensions, dtype: row.embedding_dtype,
    },
    chunkerVersion: row.chunker_version, totalChunks: row.chunk_count,
  };
}

function scoredChunk(row: ChunkRow): ScoredChunk {
  return {
    id: row.id, path: row.path, content: row.content,
    startOffset: row.start_offset, endOffset: row.end_offset, score: row.score,
  };
}

function validateVector(vector: readonly number[]) {
  if (vector.length !== 384 || vector.some((coordinate) => !Number.isFinite(coordinate)) ||
      !vector.some((coordinate) => coordinate !== 0)) {
    throw new Error('Expected a finite nonzero 384-dimensional embedding');
  }
}

export class PostgresEvidenceIndex implements EvidenceIndex {
  constructor(private readonly database: Database) {}

  async findIndex(sourceRevisionId: string, embedding: EmbeddingIdentity) {
    const { rows } = await this.database.pool.query<ManifestRow>(`
      SELECT * FROM source_indexes WHERE revision_id = $1 AND embedding_model = $2
        AND embedding_revision = $3 AND embedding_dimensions = $4
        AND embedding_dtype = $5 AND chunker_version = $6
    `, [sourceRevisionId, embedding.model, embedding.revision, embedding.dimensions, embedding.dtype, chunkerVersion]);
    return rows[0] ? manifest(rows[0]) : undefined;
  }

  async indexRevision(
    sourceRevisionId: string,
    documents: readonly { path: string; content: string }[],
    embeddedChunks: readonly (SourceChunk & { embedding: number[] })[],
    embedding: EmbeddingIdentity,
  ): Promise<EvidenceIndexManifest> {
    const expectedChunks = documents.flatMap((document) => chunkDocument(document.path, document.content));
    if (embedding.dimensions !== 384 || expectedChunks.length === 0 || expectedChunks.length > 512 ||
        embeddedChunks.length !== expectedChunks.length || new Set(documents.map((doc) => doc.path)).size !== documents.length) {
      throw new Error('Expected a complete evidence index with one to 512 chunks');
    }
    for (const [position, chunk] of embeddedChunks.entries()) {
      const expected = expectedChunks[position]!;
      if (chunk.id !== expected.id || chunk.path !== expected.path || chunk.content !== expected.content ||
          chunk.startOffset !== expected.startOffset || chunk.endOffset !== expected.endOffset) {
        throw new Error('Embedding chunks do not match the source documents');
      }
      validateVector(chunk.embedding);
    }
    const id = `chunks:${createHash('sha256').update(JSON.stringify([
      sourceRevisionId, embedding.model, embedding.revision, embedding.dimensions, embedding.dtype, chunkerVersion,
    ])).digest('hex')}`;
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
      const existing = await client.query<ManifestRow>('SELECT * FROM source_indexes WHERE id = $1', [id]);
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return manifest(existing.rows[0]);
      }
      const stored = await client.query<{ path: string; content: string }>(
        'SELECT path, content FROM source_documents WHERE revision_id = $1', [sourceRevisionId]);
      const storedDocuments = new Map(stored.rows.map((row) => [row.path, row.content]));
      if (stored.rows.length !== documents.length || documents.some((doc) => storedDocuments.get(doc.path) !== doc.content)) {
        throw new Error('Evidence index source revision does not match the supplied documents');
      }
      for (const chunk of embeddedChunks) {
        await client.query(`
          INSERT INTO source_chunks (index_id, revision_id, id, path, start_offset, end_offset, content, embedding)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::real[])
        `, [id, sourceRevisionId, chunk.id, chunk.path, chunk.startOffset, chunk.endOffset, chunk.content, chunk.embedding]);
      }
      const { rows } = await client.query<ManifestRow>(`
        INSERT INTO source_indexes (id, revision_id, embedding_model, embedding_revision,
          embedding_dimensions, embedding_dtype, chunker_version, chunk_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
      `, [id, sourceRevisionId, embedding.model, embedding.revision, embedding.dimensions,
        embedding.dtype, chunkerVersion, embeddedChunks.length]);
      await client.query('COMMIT');
      return manifest(rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async searchKeyword(indexId: string, question: string, limit: number) {
    const { rows } = await this.database.pool.query<ChunkRow>(`
      WITH query AS (
        SELECT string_agg(quote_literal(lexeme), ' | ' ORDER BY lexeme)::tsquery AS terms
        FROM unnest(tsvector_to_array(to_tsvector('english', $2))) AS lexeme
      )
      SELECT c.id, c.path, c.content, c.start_offset, c.end_offset,
        ts_rank_cd(c.search_terms, query.terms)::double precision AS score
      FROM source_chunks AS c CROSS JOIN query
      WHERE c.index_id = $1 AND c.search_terms @@ query.terms
      ORDER BY score DESC, c.path, c.start_offset LIMIT $3
    `, [indexId, question, limit]);
    return rows.map(scoredChunk);
  }

  async searchSemantic(indexId: string, vector: readonly number[], limit: number) {
    validateVector(vector);
    // Exact cosine scans the bounded immutable corpus; this is not an ANN or pgvector index.
    const { rows } = await this.database.pool.query<ChunkRow>(`
      SELECT c.id, c.path, c.content, c.start_offset, c.end_offset,
        coordinates.dot / sqrt(coordinates.document_norm * coordinates.query_norm) AS score
      FROM source_chunks AS c
      CROSS JOIN LATERAL (
        SELECT sum(document_value::double precision * query_value::double precision) AS dot,
          sum(document_value::double precision ^ 2) AS document_norm,
          sum(query_value::double precision ^ 2) AS query_norm
        FROM unnest(c.embedding, $2::real[]) AS components(document_value, query_value)
      ) AS coordinates
      WHERE c.index_id = $1
      ORDER BY score DESC, c.path, c.start_offset LIMIT $3
    `, [indexId, vector, limit]);
    return rows.map(scoredChunk);
  }

  async expandContext(indexId: string, chunkIds: readonly string[]) {
    if (chunkIds.length > 40 || new Set(chunkIds).size !== chunkIds.length) {
      throw new Error('Context expansion requires at most forty distinct indexed chunks');
    }
    const { rows } = await this.database.pool.query<ChunkRow & { document: string }>(`
      SELECT c.id, c.path, c.content, c.start_offset, c.end_offset, d.content AS document
      FROM source_chunks AS c JOIN source_documents AS d
        ON d.revision_id = c.revision_id AND d.path = c.path
      WHERE c.index_id = $1 AND c.id = ANY($2::text[])
      ORDER BY array_position($2::text[], c.id)
    `, [indexId, chunkIds]);
    if (rows.length !== chunkIds.length) throw new Error('Context seed is absent from the pinned index');
    return rows.map((row) => contextWindow({
      id: row.id, path: row.path, content: row.content, startOffset: row.start_offset, endOffset: row.end_offset,
    }, row.document));
  }
}
