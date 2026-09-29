ALTER TABLE assessment_runs
  ADD COLUMN n8n_execution_id text UNIQUE,
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed'));

UPDATE assessment_runs AS run
SET status = 'completed'
WHERE (
  SELECT count(*) FROM requirement_assessments
  WHERE run_id = run.id
) = 3;
