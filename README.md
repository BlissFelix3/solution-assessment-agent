# Solution / Under the Hood

An interactive demonstration of a real **RAG assessment pipeline coordinated by n8n**. Follow a request through the webhook, document retrieval, Gemini generation, citation validation, database writes, and final dossier. Select a step to inspect its evidence, payloads, and implementation.

The scenario is fictional. Three integration requirements test SAML sign-in, HTTPS event delivery, and a first-delivery timing guarantee. The documents support the first two; the timing guarantee must remain **unknown**. Unknown is a valid assessment, not a failed execution.

## Explore

- **Explore recorded run** loads a checked-in export of a completed n8n/Gemini execution. It works without the API or a model key. The screen explicitly labels it recorded and shows the capture date.
- **Run live workflow** starts n8n through the API. The page polls durable execution evidence, follows the selected requirement, and preserves the run ID in its URL.
- Select **Retrieve** for the ranked documents; **Generate** for model inputs and its draft; **Validate** for exact citation checks; **Persist** for saved results and reuse; **Assemble dossier** for the resulting implementation steps.
- Each inspector has payloads and a link to the responsible source. Citations open the pinned document; the trace can be exported as JSON.

## What actually runs

```text
Browser → NestJS admission → authenticated n8n webhook
                                 ↓
                       Create run + pin source revision
                                 ↓
                       Prepare three requirement items
                                 ↓
          NestJS: PostgreSQL retrieval → Gemini → validate → persist
                                 ↓
                 n8n: verify responses + read saved assessments
                                 ↓
                   Build deterministic dossier → complete

n8n Error Trigger → mark the matching execution failed
```

Retrieval uses PostgreSQL English full-text search and `ts_rank_cd`, returning up to five documents from one immutable revision. It currently uses keyword retrieval; there are no vector embeddings. Gemini receives the selected documents and a JSON response schema. Trusted application code validates field shapes, verdict rules, source paths, and exact quote membership. Exact quote membership does not itself establish semantic entailment.

n8n owns workflow sequencing, retries, and failure routing. NestJS owns domain rules and validation; controllers only route requests. PostgreSQL enforces immutable evidence and one assessment per run/question. A lost response can be retried without regenerating an already saved answer.

## Execution evidence

`GET /runs/:id/trace` returns the run identity, n8n execution ID, pinned revision, coarse status, and ordered events. Each assessment invocation has its own attempt UUID. Events capture retrieved candidates, model input/output, validation results, and persistence outcomes. Failed attempts remain visible alongside later retries.

Run creation, assessment insertion, dossier creation, completion, and failure events commit in the same SQL statement as their state change. The webhook acknowledgment is recorded after its response arrives; a tracing failure cannot hide an already accepted run ID. Public trace data excludes authentication headers, provider error bodies, and arbitrary model metadata.

These are API boundary observations, not internal n8n node telemetry. A pending stage without a terminal event is not assumed successful. Runs predating tracing have no fabricated history. After ten minutes, an unreported outcome is shown as timed out and may subsequently change.

## Run locally

Requires Node 22.12+, pnpm 9, PostgreSQL, and n8n. The exported workflow was tested with n8n 2.39.10.

```sh
pnpm install
export DATABASE_URL='postgresql://localhost/solution_assessment'
pnpm db:migrate
pnpm db:seed
```

Configure the API environment:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection |
| `GEMINI_API_KEY` | Server-side model credential |
| `INTERNAL_API_TOKEN` | Authenticates n8n writes to the API |
| `N8N_START_WEBHOOK_URL` | Published n8n start webhook |
| `N8N_START_TOKEN` | Separate authentication token for that webhook |
| `DEMO_RUNS_PER_HOUR` | Required positive global hourly start allowance |

The API reads process environment variables. Export them in your shell or load a local ignored `.env` before starting it. Never commit credentials. Follow [n8n setup](n8n/README.md) to import, configure, and publish the workflow.

```sh
pnpm --filter @solution-assessment/api start
pnpm dev:web
```

Open `http://127.0.0.1:5173`. Vite proxies `/runs` to the API at port 3000. The recorded example also works with only the frontend running.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build:web
pnpm eval:retrieval
```

`pnpm test` runs API and frontend tests. The PostgreSQL integration test is skipped unless `TEST_DATABASE_URL` points to a separately migrated, seeded test database. It tests concurrent saves, atomic state/event writes, immutability, and duplicate completion/failure calls; it appends test records, so use a disposable test database.

```sh
TEST_DATABASE_URL='postgresql://localhost/solution_assessment_test' pnpm test
```

To refresh the public recording after a completed real run:

```sh
node apps/web/scripts/record-execution.mjs <run-uuid>
```

The export reads only public run endpoints and checks captured source text against this repository's fictional fixtures. Inspect the exported model prose before publishing it. The existing recording was checked for fixture provenance and absence of credential values.

## Deployment boundary

`pnpm build:web` produces the static frontend in `apps/web/dist`. Static hosting can serve the architecture and recorded execution on its own. Live runs also require the API, persistent PostgreSQL, persistent n8n, server-side credentials, and a same-origin reverse proxy for `/runs`. The Vite development proxy is not included in the static build.

Apply additive migration `007_run_events.sql` before running this API version. Earlier API versions can run with the additional table left in place; do not delete execution history to roll back the UI. This repository does not provision a production deployment yet.
