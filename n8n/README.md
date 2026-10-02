# Local assessment workflow

Start the API with a migrated, seeded database and `GROQ_API_KEY` configured (or an optional Cerebras/Gemini key). Set `INTERNAL_API_TOKEN` on the API. Create a **Header Auth** credential named **API worker access** with header name `X-Internal-Token` and the same token value; select it on **Create run**, **Assess requirement**, **Create dossier**, **Complete run**, and **Mark failed**. Those write routes reject requests without it.

Import `complete-assessment.json` into n8n. This workflow was tested with n8n 2.39.10. Set **Set API URL** and the URL in **Mark failed** to the address where n8n can reach the API. Both default to `http://127.0.0.1:3000` when both run on the same machine.

For server-initiated runs, create a **Header Auth** credential named **Demo start webhook** with header name `X-Demo-Token` and a separate private token value. Select it on **Start assessment**, then publish the workflow. Set `N8N_START_WEBHOOK_URL` on the API to the production webhook URL and `N8N_START_TOKEN` to that token. Keep both tokens on the server, not in browser code.

`POST /runs/demo` accepts `{ "requirements": ["Can we replay failed webhooks?"] }` with one to three distinct nonblank questions, each up to 500 characters. Omitting requirements preserves the prepared three-question scenario. Invalid inputs are rejected before admission. It checks the required `DEMO_RUNS_PER_HOUR` setting, reserves one place in the global rolling-hour allowance, and calls n8n. **Return run ID** responds with HTTP 202 and `{ runId, sourceRevisionId, requirements }` after the run is created; n8n continues the submitted assessments. Read `status` and saved results from `GET /runs/{runId}/assessments`. An admitted start counts toward the allowance even if its n8n response is lost, so an uncertain run cannot escape the cost limit.

For local verification without a webhook request, run **Start locally** in the n8n editor.

The workflow creates one run with its n8n execution ID, persists its submitted requirement snapshot, assesses those questions, verifies every response matches that snapshot and run, reads the saved assessments, saves one ordered implementation path, then marks the run completed. The path uses the saved verdicts and links each step to its assessment; it makes no extra model call. A failed API call stops the workflow. The assessment call retries once; the API returns an existing saved result if its first response was lost.

For published webhook executions, **Run failed** receives n8n's execution ID and **Mark failed** updates the matching run. n8n does not fire its Error Trigger for manual editor runs. If neither outcome is reported within ten minutes, the read endpoint displays `timed_out`; it can later show a reported completion or failure.

Keep n8n's execution database persistent across redeployments because the API links each run to an n8n execution ID.

The visual demonstration reads durable execution evidence from `GET /runs/{runId}/trace`. It records actual retrieval candidates, model input/output, validation, persistence, and per-attempt identities inside the API. Run creation and final completion have separate events: accepting an n8n execution does not mean its workflow has finished. The exported workflow definition and n8n execution ID are available in the inspector. Apply migrations through 008 and update this workflow alongside the API. Set API URL retains the incoming webhook body; Create run forwards its requirements. Prepare requirements reads the persisted snapshot returned by the API.
