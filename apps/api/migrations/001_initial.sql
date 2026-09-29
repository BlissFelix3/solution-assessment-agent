CREATE TABLE source_revisions (
  id text PRIMARY KEY,
  origin text NOT NULL CHECK (origin IN ('fixture', 'github')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_documents (
  revision_id text NOT NULL REFERENCES source_revisions(id),
  path text NOT NULL,
  content text NOT NULL,
  PRIMARY KEY (revision_id, path)
);

CREATE TABLE active_source_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision_id text NOT NULL REFERENCES source_revisions(id)
);

CREATE TABLE assessment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario text NOT NULL CHECK (scenario = 'northstar'),
  source_revision_id text NOT NULL REFERENCES source_revisions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
