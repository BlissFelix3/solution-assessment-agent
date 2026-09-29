CREATE TABLE demo_start_admissions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX demo_start_admissions_admitted_at_idx ON demo_start_admissions (admitted_at);
