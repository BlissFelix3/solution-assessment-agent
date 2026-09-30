# Solution Assessment Agent

A usable **solution assessment agent** with an illustration of its actual backend execution alongside the assessment. Submit integration requirements, receive cited verdicts and an implementation path, and inspect that same request through the webhook, n8n workflow, retrieval, generation, validation and storage.

The corpus is fictional product documentation covering SAML sign-in, HTTPS account-event delivery and related capabilities. The default three questions include a first-delivery timing guarantee the documents do not establish. **Unknown** is a valid answer when evidence is missing; a provider failure is a failed execution, never an unknown verdict.

## Use and inspect

- Enter **one to three requirements**, edit the starting examples, or remove/add a question. Each question is bounded to 500 characters. **Assess requirements** submits these inputs through the authenticated n8n webhook. The API saves an immutable requirement snapshot and a pinned document revision for that run.
- The left pane displays the submitted questions, saved answers, citations, missing evidence and the dossier. **Edit & assess again** opens those questions for a new run. Existing answers remain attached to their original input.
- The right pane displays the same run's actual API boundary events. Select **Retrieve** for ranked documents, **Generate** for model inputs and draft output, **Validate** for citation checks, **Persist** for saved/reused results, and **Assemble dossier** for implementation steps. Failures and retries remain inspectable.
- **Explore a completed example** is an explicit, checked-in recording. It can be inspected without the API or a model key and is labeled separately from submitted live requests. Replay advances through its actual event order, slowed for inspection; answers and the dossier appear only after their recorded persistence events.
- Citations open their exact pinned source document. Stage inspectors expose evidence, payloads, and links to the responsible code. The live run ID stays in the URL.

Demo inputs and evidence are publicly inspectable. Use fictional requirements rather than confidential customer information. Provider outages and rate limits stop the live run; the UI does not substitute recorded answers for custom requests.

The central artwork is an original 3D-style render used as a visual metaphor. HTML controls and event-driven SVG signals sit above it; every status, payload, and citation comes from the loaded trace. The artwork and its generation prompt are in `apps/web/public/backend-machine.png` and `apps/web/public/backend-machine.prompt.txt`. Reduced-motion preferences disable visual movement.

## What actually runs

```text
Browser → NestJS admission → authenticated n8n webhook
                                 ↓
                       Create run + pin source revision
                                 ↓
                       Prepare the submitted requirement items
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

`GET /runs/:id/trace` returns the run identity, n8n execution ID, pinned revision, immutable submitted requirements, coarse status, and ordered events. Each assessment invocation has its own attempt UUID. Events capture retrieved candidates, model input/output, validation results, and persistence outcomes. Failed attempts remain visible alongside later retries.

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

`pnpm test` runs API and frontend tests. The PostgreSQL integration test is skipped unless `TEST_DATABASE_URL` points to a separately migrated, seeded test database. It tests concurrent saves, atomic state/event writes, immutable submitted input, rejection of foreign questions, one-question completion and duplicate completion/failure calls; it appends test records, so use a disposable test database.

```sh
TEST_DATABASE_URL='postgresql://localhost/solution_assessment_test' pnpm test
```

To refresh the public recording after a completed real run:

```sh
node apps/web/scripts/record-execution.mjs <run-uuid>
```

The export reads only public run endpoints and checks captured source text against this repository's fictional fixtures. Inspect the exported model prose before publishing it. The existing recording was checked for fixture provenance and absence of credential values.

## Deployment boundary

`pnpm build:web` produces the static frontend in `apps/web/dist`. Static hosting can serve the workspace and recorded example on its own. Live runs also require the API, persistent PostgreSQL, persistent n8n, server-side credentials, and a same-origin reverse proxy for `/runs`. The Vite development proxy is not included in the static build.

Apply additive migrations through `008_run_requirements.sql`, then deploy the matching API and n8n workflow before the frontend. Keep the additional tables and requirement snapshots when rolling back; the earlier API only supports the prepared three-question scenario. This repository does not provision a production deployment yet.
