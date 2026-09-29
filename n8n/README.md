# Local assessment workflow

Start the API with a migrated, seeded database and `GEMINI_API_KEY` configured.

Import `complete-assessment.json` into n8n. This workflow was tested with n8n 2.39.10. Set **Set API URL** to the address where n8n can reach the API. The default is `http://127.0.0.1:3000` when both run on the same machine.

For server-initiated runs, create a **Header Auth** credential named **Demo start webhook** with header name `X-Demo-Token` and a private token value. Select it on **Start assessment**, then publish the workflow. A server can `POST /webhook/solution-assessments` with that header. **Return run ID** responds with HTTP 202 and `{ runId, sourceRevisionId }` after the run is created; n8n continues the three assessments. Read their saved results from `GET /runs/{runId}/assessments` on the API. Keep the token on the server, not in browser code.

For local verification without a webhook request, run **Start locally** in the n8n editor.

The workflow creates one run, assesses the three prepared requirements, verifies all three responses belong to that run, then reads the saved assessments. A failed API call stops the workflow. The assessment call retries once; the API returns an existing saved result if its first response was lost.

The final node outputs the saved assessment list and pinned source revision. The browser-facing API entry point and execution reporting will be separate steps.
