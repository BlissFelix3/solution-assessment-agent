# Local assessment workflow

Start the API with a migrated, seeded database and `GEMINI_API_KEY` configured. Set `INTERNAL_API_TOKEN` on the API. Create a **Header Auth** credential named **API worker access** with header name `X-Internal-Token` and the same token value; select it on **Create run** and **Assess requirement**. Those write routes reject requests without it.

Import `complete-assessment.json` into n8n. This workflow was tested with n8n 2.39.10. Set **Set API URL** to the address where n8n can reach the API. The default is `http://127.0.0.1:3000` when both run on the same machine.

For server-initiated runs, create a **Header Auth** credential named **Demo start webhook** with header name `X-Demo-Token` and a separate private token value. Select it on **Start assessment**, then publish the workflow. Set `N8N_START_WEBHOOK_URL` on the API to the production webhook URL and `N8N_START_TOKEN` to that token. Keep both tokens on the server, not in browser code.

`POST /runs/demo` on the API accepts the fixed scenario without a request body. It checks the required `DEMO_RUNS_PER_HOUR` setting, reserves one place in the global rolling-hour allowance, and calls n8n. **Return run ID** responds with HTTP 202 and `{ runId, sourceRevisionId }` after the run is created; n8n continues the three assessments. Read their saved results from `GET /runs/{runId}/assessments`. An admitted start counts toward the allowance even if its n8n response is lost, so an uncertain run cannot escape the cost limit.

For local verification without a webhook request, run **Start locally** in the n8n editor.

The workflow creates one run, assesses the three prepared requirements, verifies all three responses belong to that run, then reads the saved assessments. A failed API call stops the workflow. The assessment call retries once; the API returns an existing saved result if its first response was lost.

The final node outputs the saved assessment list and pinned source revision. Execution reporting remains a separate step.
