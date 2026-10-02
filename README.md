# Solution Assessment Agent

A usable **solution assessment agent** with an illustration of its actual backend execution alongside the assessment. Submit integration requirements, receive cited verdicts and an implementation path, and inspect that same request through the webhook, n8n workflow, retrieval, generation, validation and storage.

The corpus is fictional product documentation covering SAML sign-in, HTTPS account-event delivery and related capabilities. The default three questions include a first-delivery timing guarantee the documents do not establish. **Unknown** is a valid answer when evidence is missing; a provider failure is a failed execution, never an unknown verdict.

## Use and inspect

- Read all nine complete source documents in the knowledge-base pane before asking a question. The starting reader shows this repository's fictional corpus; during a live run it reads the run's exact pinned revision from the API.
- Start with an empty question, choose an optional suggested prompt, or add up to three questions. **Ask question** sends those inputs through the authenticated n8n webhook. Each question is bounded to 500 characters.
- Expand **Under the hood** to see the actual nodes and connections imported from `n8n/complete-assessment.json`, including the local trigger and failure path. This is the exported definition, not a live n8n editor. Node buttons show their exact exported parameters. The assessment node links to its nested API retrieval context. Node badges highlight only calls confirmed by API receipts for the selected question. Code nodes without telemetry remain unmarked; a later workflow failure cannot overwrite a confirmed run-creation receipt.
- Retrieval, generation, validation and persistence read durable backend events. The UI reports retrieving documentation and checking citations when those events are observed, and exposes the full retrieved text, ranks, prompts, model payloads and execution receipts. It collapses the execution details when the assessment finishes; reopen them to inspect the evidence.
- Answers contain source citations and an implementation path. Citations open the full pinned source and highlight the exact quoted passage. **New question** starts a fresh request.
- **Open recorded example** is an explicit secondary action with its original questions and provider. Replay exposes results only after their recorded persistence events. It never substitutes recorded answers for custom questions. The live run ID remains in the URL.

Demo inputs and evidence are publicly inspectable. Use fictional requirements. Provider errors stop an execution rather than inventing an answer. Reduced-motion preferences disable the active-status animation; every control remains usable by keyboard.

## Visual direction

The interface uses a new aperture wordmark, self-hosted Manrope typography, lavender glass surfaces and a horizontal document selector. The original SVG evidence lens separates source, retrieval and saved assessment layers. Each layer opens the relevant inspector. Its active motion is driven by observed API events; idle artwork does not simulate execution. The complete source text and question composer remain ordinary accessible HTML beside the illustration. Reduced-motion preferences remove the movement.

## What actually runs

```text
Browser → NestJS admission → authenticated n8n webhook
                                 ↓
                       Create run + pin source revision
                                 ↓
                       Prepare the submitted requirement items
                                 ↓
          NestJS: PostgreSQL retrieval → configured model → validate → persist
                                 ↓
                 n8n: verify responses + read saved assessments
                                 ↓
                   Build deterministic dossier → complete

n8n Error Trigger → mark the matching execution failed
```

Retrieval uses PostgreSQL English full-text search and `ts_rank_cd`, returning up to five documents from one immutable revision. It currently uses keyword retrieval; there are no vector embeddings. The configured model receives only the question, selected documents and a JSON response schema. Trusted application code validates field shapes, verdict rules, source paths, and exact quote membership. Exact quote membership does not itself establish semantic entailment.

n8n owns workflow sequencing, retries, and failure routing. NestJS owns domain rules and validation; controllers only route requests. PostgreSQL enforces immutable evidence and one assessment per run/question. A lost response can be retried without regenerating an already saved answer.

## Model access and limits

Configure Groq first for the compact GPT-OSS 20B model, with low reasoning effort and a 2,048-token output budget. Obtain your own key from [Groq's console](https://console.groq.com/keys). Keys stay on the server; the browser never receives them. Copy `.env.example` to an ignored `.env` and fill only the providers you want to use.

As checked on October 2, 2026, [Groq lists a free allowance](https://console.groq.com/docs/rate-limits) for GPT-OSS 20B of 30 requests/minute, 1,000/day, 8,000 tokens/minute and 200,000/day. Exact account limits can differ. [GPT-OSS 20B](https://console.groq.com/docs/model/openai/gpt-oss-20b) supports strict JSON schema output. These are quotas, not a guarantee that requests will never time out.

Provider order is Groq → Cerebras → Gemini, using only configured keys. Each provider is attempted once per generation invocation with a 15-second request deadline and a shared 30-second generation budget. Rate limits, server outages and transport failures may fall through to the next configured provider; authentication errors, malformed responses and incomplete output fail. n8n retains its existing single workflow retry. Traces identify each actual attempted provider and model, and retain safe failure reasons. No provider error bodies or keys are recorded.

[Cerebras currently describes a trial](https://inference-docs.cerebras.ai/support/rate-limits), requiring a verified payment method, with $5 credits expiring after 30 days. It does not offer a permanently renewing free allowance. Both providers document organization-level quotas: adding keys within the same organization does not increase them. Do not depend on the pasted Aura guide's no-card, unlimited-reliability or key-multiplication claims. Speech and vision providers are unnecessary for this text-document product.

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
| `GROQ_API_KEY` | Recommended server-side model credential; default `openai/gpt-oss-20b` |
| `GROQ_MODEL` | Optional Groq model override |
| `CEREBRAS_API_KEY` / `CEREBRAS_MODEL` | Optional fallback; default `gpt-oss-120b` |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Optional legacy fallback; default `gemini-3.6-flash` |
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
