ALTER TABLE assessment_runs ADD COLUMN implementation_path jsonb;

UPDATE assessment_runs AS run
SET implementation_path = (
  SELECT jsonb_agg(jsonb_build_object(
    'questionId', question_id,
    'readiness', CASE verdict
      WHEN 'supported' THEN 'ready'
      WHEN 'unsupported' THEN 'blocked'
      ELSE 'needs_evidence'
    END,
    'action', CASE
      WHEN question_id = 'employee-saml-sign-in' AND verdict = 'supported'
        THEN 'Plan employee SAML 2.0 sign-in using the cited product capability.'
      WHEN question_id = 'employee-saml-sign-in' AND verdict = 'unsupported'
        THEN 'Plan an alternative employee sign-in approach; do not promise SAML 2.0.'
      WHEN question_id = 'employee-saml-sign-in'
        THEN 'Request documentation confirming employee SAML 2.0 sign-in before committing.'
      WHEN question_id = 'https-account-event-webhook' AND verdict = 'supported'
        THEN 'Plan account-event delivery to Northstar’s HTTPS endpoint using the cited product capability.'
      WHEN question_id = 'https-account-event-webhook' AND verdict = 'unsupported'
        THEN 'Plan another event-delivery approach; do not promise an HTTPS account-event webhook.'
      WHEN question_id = 'https-account-event-webhook'
        THEN 'Request documentation confirming account-event delivery to an HTTPS webhook before committing.'
      WHEN question_id = 'first-attempt-60-seconds' AND verdict = 'supported'
        THEN 'Document the cited 60-second first-attempt guarantee as an acceptance criterion.'
      WHEN question_id = 'first-attempt-60-seconds' AND verdict = 'unsupported'
        THEN 'Remove the 60-second promise and agree on a documented delivery expectation.'
      ELSE 'Obtain a documented first-attempt delivery guarantee before promising 60 seconds.'
    END
  ) ORDER BY CASE question_id
    WHEN 'employee-saml-sign-in' THEN 1
    WHEN 'https-account-event-webhook' THEN 2
    ELSE 3
  END)
  FROM requirement_assessments
  WHERE run_id = run.id
)
WHERE status = 'completed';

ALTER TABLE assessment_runs ADD CONSTRAINT completed_requires_implementation_path
  CHECK (status <> 'completed' OR implementation_path IS NOT NULL);
