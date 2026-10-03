CREATE TABLE source_indexes (
  id text PRIMARY KEY,
  revision_id text NOT NULL REFERENCES source_revisions(id),
  embedding_model text NOT NULL,
  embedding_revision text NOT NULL,
  embedding_dimensions integer NOT NULL CHECK (embedding_dimensions = 384),
  embedding_dtype text NOT NULL CHECK (embedding_dtype = 'q8'),
  chunker_version text NOT NULL,
  chunk_count integer NOT NULL CHECK (chunk_count BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, revision_id),
  UNIQUE (revision_id, embedding_model, embedding_revision, embedding_dtype, chunker_version)
);

CREATE TABLE source_chunks (
  index_id text NOT NULL,
  revision_id text NOT NULL,
  id text NOT NULL,
  path text NOT NULL,
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  content text NOT NULL CHECK (length(content) > 0),
  embedding real[] NOT NULL CHECK (
    array_ndims(embedding) = 1 AND cardinality(embedding) = 384
    AND array_position(embedding, NULL) IS NULL
    AND NOT (embedding && ARRAY['NaN'::real, 'Infinity'::real, '-Infinity'::real])
    AND cardinality(array_remove(embedding, 0::real)) > 0
  ),
  search_terms tsvector GENERATED ALWAYS AS (to_tsvector('english', path || ' ' || content)) STORED,
  PRIMARY KEY (index_id, id),
  FOREIGN KEY (index_id, revision_id) REFERENCES source_indexes(id, revision_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (revision_id, path) REFERENCES source_documents(revision_id, path)
);

CREATE INDEX source_chunks_search_terms ON source_chunks USING gin(search_terms);

CREATE FUNCTION reject_published_chunk_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.index_id, 0));
  IF EXISTS (SELECT 1 FROM source_indexes WHERE id = NEW.index_id) THEN
    RAISE EXCEPTION 'Published evidence indexes are immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM source_documents
    WHERE revision_id = NEW.revision_id AND path = NEW.path
      AND position(NEW.content IN content) > 0
  ) THEN
    RAISE EXCEPTION 'Evidence chunk is absent from its source revision';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER source_chunks_sealed_insert BEFORE INSERT ON source_chunks
FOR EACH ROW EXECUTE FUNCTION reject_published_chunk_insert();

CREATE FUNCTION verify_evidence_index_publication()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id, 0));
  IF (SELECT count(*) FROM source_chunks WHERE index_id = NEW.id) <> NEW.chunk_count THEN
    RAISE EXCEPTION 'Evidence index needs all declared chunks before publication';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER source_indexes_complete_insert BEFORE INSERT ON source_indexes
FOR EACH ROW EXECUTE FUNCTION verify_evidence_index_publication();

CREATE TRIGGER source_indexes_no_update_delete BEFORE UPDATE OR DELETE ON source_indexes
FOR EACH ROW EXECUTE FUNCTION reject_source_history_change();
CREATE TRIGGER source_indexes_no_truncate BEFORE TRUNCATE ON source_indexes
FOR EACH STATEMENT EXECUTE FUNCTION reject_source_history_change();
CREATE TRIGGER source_chunks_no_update_delete BEFORE UPDATE OR DELETE ON source_chunks
FOR EACH ROW EXECUTE FUNCTION reject_source_history_change();
CREATE TRIGGER source_chunks_no_truncate BEFORE TRUNCATE ON source_chunks
FOR EACH STATEMENT EXECUTE FUNCTION reject_source_history_change();
