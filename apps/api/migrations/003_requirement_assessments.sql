CREATE TABLE requirement_assessments (
  run_id uuid NOT NULL REFERENCES assessment_runs(id),
  question_id text NOT NULL CHECK (btrim(question_id) <> ''),
  verdict text NOT NULL CHECK (verdict IN ('supported', 'unsupported', 'unknown')),
  explanation text NOT NULL CHECK (btrim(explanation) <> ''),
  basis jsonb NOT NULL CHECK (jsonb_typeof(basis) = 'array'),
  not_proof jsonb NOT NULL CHECK (jsonb_typeof(not_proof) = 'array'),
  missing_evidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, question_id),
  CHECK (
    (verdict = 'unknown' AND basis = '[]'::jsonb
      AND missing_evidence IS NOT NULL AND btrim(missing_evidence) <> '')
    OR
    (verdict IN ('supported', 'unsupported') AND basis <> '[]'::jsonb
      AND missing_evidence IS NULL)
  )
);

CREATE FUNCTION reject_requirement_assessment_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Requirement assessments are immutable';
END;
$$;

CREATE TRIGGER requirement_assessments_no_update_delete
BEFORE UPDATE OR DELETE ON requirement_assessments
FOR EACH ROW EXECUTE FUNCTION reject_requirement_assessment_change();

CREATE TRIGGER requirement_assessments_no_truncate
BEFORE TRUNCATE ON requirement_assessments
FOR EACH STATEMENT EXECUTE FUNCTION reject_requirement_assessment_change();
