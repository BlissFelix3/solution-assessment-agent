CREATE TABLE source_collections (
  id text PRIMARY KEY CHECK (id IN ('northstar', 'last-broadcast')),
  revision_id text NOT NULL REFERENCES source_revisions(id)
);

INSERT INTO source_collections (id, revision_id)
SELECT 'northstar', revision_id FROM active_source_revision WHERE singleton = true;

ALTER TABLE assessment_runs DROP CONSTRAINT assessment_runs_scenario_check;
ALTER TABLE assessment_runs ADD CONSTRAINT assessment_runs_scenario_check
  CHECK (scenario IN ('northstar', 'last-broadcast'));
ALTER TABLE assessment_runs ADD COLUMN retrieval_mode text NOT NULL DEFAULT 'keyword'
  CHECK (retrieval_mode IN ('hybrid', 'keyword'));

CREATE FUNCTION prevent_run_context_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scenario IS DISTINCT FROM OLD.scenario
     OR NEW.source_revision_id IS DISTINCT FROM OLD.source_revision_id
     OR NEW.retrieval_mode IS DISTINCT FROM OLD.retrieval_mode THEN
    RAISE EXCEPTION 'Run collection, source revision and retrieval mode are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER immutable_run_context
BEFORE UPDATE OF scenario, source_revision_id, retrieval_mode ON assessment_runs
FOR EACH ROW EXECUTE FUNCTION prevent_run_context_changes();
