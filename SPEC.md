# Enterprise Solution Assessment Agent

A visitor selects a prepared integration request for a fictional software platform.
The system completes a dossier for every requirement.

- **Supported:** current evidence explicitly meets the requirement.
- **Unsupported:** current evidence explicitly rules it out.
- **Unknown:** the available evidence establishes neither result.

Each result names the source revision searched, cites relevant passages when present,
and explains missing evidence when the result is Unknown. The dossier includes a
proposed implementation path grounded in those sources without inventing commitments.
Historical citations open the exact passage and source revision used for that dossier,
even after the active source changes.
Each source document version is stored in full and never overwritten. A citation points
to a passage in the stored version used by its dossier.
Each run uses the active source revision from when it started for every search and result.
Publishing a newer revision affects new runs, not runs already in progress.

## Requirement assessment

Each assessment contains a prepared `questionId`, a `verdict`, and an `explanation`.
The server attaches the run ID and its pinned source revision; model output cannot choose them.
Supported and Unsupported assessments require a nonempty `basis` of `{ path, quote }` entries
that explicitly justify the verdict. Unknown assessments have no `basis` and require
`missingEvidence` naming the fact needed to resolve the question.
Any verdict may include `notProof` entries with `{ path, quote, reason }`. The reason
explains why the quote does not establish the requirement. For the 60-second question,
the dashboard-refresh sentence is `notProof`: it describes display timing, not
first-attempt delivery timing.
Before saving an assessment, the server verifies that every quoted passage appears in
a document retrieved from the run's pinned source revision. A real quote can still be
used incorrectly, so evaluation checks verdicts and quote roles against labeled cases.

n8n coordinates the run through completion without a reviewer or approval step.
