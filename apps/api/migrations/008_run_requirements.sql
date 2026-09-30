-- Existing runs used these three fixed questions.
ALTER TABLE assessment_runs ADD COLUMN requirements jsonb NOT NULL DEFAULT '[
  {
    "id": "employee-saml-sign-in",
    "label": "Employee SSO",
    "question": "Can employees sign in with SAML 2.0?"
  },
  {
    "id": "https-account-event-webhook",
    "label": "Event delivery",
    "question": "Can our HTTPS webhook receive account events from the platform?"
  },
  {
    "id": "first-attempt-60-seconds",
    "label": "60-second guarantee",
    "question": "Is the first account-event webhook delivery attempt guaranteed within 60 seconds?"
  }
]'::jsonb
  CHECK (jsonb_typeof(requirements) = 'array' AND jsonb_array_length(requirements) BETWEEN 1 AND 3);

CREATE FUNCTION prevent_requirement_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requirements IS DISTINCT FROM OLD.requirements THEN
    RAISE EXCEPTION 'Run requirements are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_run_requirements BEFORE UPDATE OF requirements ON assessment_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_requirement_changes();

CREATE FUNCTION require_run_question() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM assessment_runs, jsonb_array_elements(requirements) AS requirement
    WHERE id = NEW.run_id AND requirement->>'id' = NEW.question_id
  ) THEN
    RAISE EXCEPTION 'Question does not belong to this run';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assessment_requires_run_question BEFORE INSERT ON requirement_assessments
  FOR EACH ROW EXECUTE FUNCTION require_run_question();
