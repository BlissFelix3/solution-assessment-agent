CREATE TABLE run_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES assessment_runs(id),
  stage text NOT NULL CHECK (stage IN (
    'workflow', 'webhook', 'retrieval', 'generation', 'validation',
    'persistence', 'dossier', 'completion'
  )),
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  question_id text,
  attempt_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  CHECK ((question_id IS NULL) = (attempt_id IS NULL))
);

CREATE INDEX run_events_by_run ON run_events (run_id, id);

CREATE FUNCTION reject_run_event_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Run events are immutable';
END;
$$;

CREATE TRIGGER run_events_no_update_delete
BEFORE UPDATE OR DELETE ON run_events
FOR EACH ROW EXECUTE FUNCTION reject_run_event_change();

CREATE TRIGGER run_events_no_truncate
BEFORE TRUNCATE ON run_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_run_event_change();
