# Local assessment workflow

Start the API with a migrated, seeded database and `GROQ_API_KEY` configured (or an optional Cerebras/Gemini key). Set `INTERNAL_API_TOKEN` on the API. Create a **Header Auth** credential named **API worker access** with header name `X-Internal-Token` and the same token value; select it on **Create run**, **Assess requirement**, **Create dossier**, **Complete run**, and **Mark failed**. Those write routes reject requests without it.

Import `complete-assessment.json` into n8n. This workflow was tested with n8n 2.39.10. Set **Set API URL** and the URL in **Mark failed** to the address where n8n can reach the API. Both default to `http://127.0.0.1:3000` when both run on the same machine.

For server-initiated runs, create a **Header Auth** credential named **Demo start webhook** with header name `X-Demo-Token` and a separate private token value. Select it on **Start assessment**, then publish the workflow. Set `N8N_START_WEBHOOK_URL` on the API to the production webhook URL and `N8N_START_TOKEN` to that token. Keep both tokens on the server, not in browser code.

`POST /runs/demo` accepts `{ "requirements": ["What made the recording stop?"], "collectionId": "last-broadcast", "retrievalMode": "hybrid" }` with one to three distinct nonblank questions, each up to 500 characters. The other collection is `northstar`; `keyword` enables the retrieval comparison. Omitting the options preserves the prepared Northstar scenario. Invalid inputs are rejected before admission. It checks the required `DEMO_RUNS_PER_HOUR` setting, reserves one place in the global rolling-hour allowance, and calls n8n. **Return run ID** responds with HTTP 202 and `{ runId, sourceRevisionId, requirements }` after the run is created; n8n continues the submitted assessments. Read `status` and saved results from `GET /runs/{runId}/assessments`. An admitted start counts toward the allowance even if its n8n response is lost, so an uncertain run cannot escape the cost limit.

For local verification without a webhook request, run **Start locally** in the n8n editor.

The workflow creates one run with its n8n execution ID, persists its submitted requirement snapshot, assesses those questions, verifies every response matches that snapshot and run, reads the saved assessments, saves one ordered implementation path, then marks the run completed. The path uses the saved verdicts and links each step to its assessment; it makes no extra model call. A failed API call stops the workflow. The assessment call retries once; the API returns an existing saved result if its first response was lost.

For published webhook executions, **Run failed** receives n8n's execution ID and **Mark failed** updates the matching run. n8n does not fire its Error Trigger for manual editor runs. If neither outcome is reported within ten minutes, the read endpoint displays `timed_out`; it can later show a reported completion or failure.

Keep n8n's execution database persistent across redeployments because the API links each run to an n8n execution ID.

The visual demonstration reads durable execution evidence from `GET /runs/{runId}/trace`. It records actual retrieval candidates, model input/output, validation, persistence, and per-attempt identities inside the API. Run creation and final completion have separate events: accepting an n8n execution does not mean its workflow has finished. Apply migrations through 010 and update this workflow alongside the API. **Set API URL** retains the incoming webhook body; **Create run** forwards its requirements, collection and retrieval mode. **Prepare requirements** reads the persisted snapshot returned by the API.

## Actual n8n execution canvas

`GET /runs/{runId}/workflow` resolves the execution ID saved on that run. It reads only that execution in the explicitly configured workflow. The public route accepts a run UUID, not an arbitrary n8n execution ID. This inspector uses n8n **2.39.10**'s PostgreSQL `execution_entity` and `execution_data` schema and its flatted execution serialization; verify the adapter before upgrading n8n.

On the **n8n process**, set the following and restart it:

```dotenv
EXECUTIONS_DATA_SAVE_ON_PROGRESS=true
EXECUTIONS_DATA_SAVE_ON_SUCCESS=all
EXECUTIONS_DATA_SAVE_ON_ERROR=all
```

Saving progress is required to observe completed nodes while downstream work is still running. A node's own duration and output become visible when n8n saves that node result. The API's live assessment receipts can show active retrieval/generation separately; the canvas does not invent an in-flight node output.

On the **API process**, configure:

```dotenv
N8N_DATABASE_URL=postgresql://assessment_inspector@127.0.0.1:5433/n8n_test
N8N_WORKFLOW_ID=ce4e947b-7b86-4e35-a538-d562eaf6a432
```

Use the actual deployment host, database and imported workflow ID. The URL above illustrates the local database's port and name; `assessment_inspector` must be provisioned separately. Give that account `CONNECT`, schema `USAGE`, and `SELECT` on `execution_entity` and `execution_data` only. Configure its authentication on the server. This connection is separate from the assessment database, and it needs no public n8n API key. Keep both settings out of browser code. The local runtime uses n8n on port 5678 and the assessment API on port 3000; containers need addresses reachable from inside those containers.

The canvas renders the **saved execution's** node positions and connections, node states, timestamps, durations, source node references, and item counts. Input previews come from the exact prior node run/output referenced by n8n. They are labeled **upstream input**: these are node items, not the HTTP wire body after n8n expression evaluation. The Definition tab shows checked-in configuration separately from execution evidence.

Error Trigger handling runs in a separate n8n execution. The run-scoped canvas shows the original execution ID stored on the run: its failing node remains inspectable, while its error-handler lane can have no node results even when the API received the separate failure callback.

The reader exposes only approved assessment fields. Headers, credential configuration, URLs, binary attachments, and raw transport errors are excluded at every depth. Previews allow 50 items per array, 20,000 characters per string, depth 8, and a shared execution budget of 5,000 values/500,000 text characters. Original item counts remain visible, and truncated previews are marked. Execution data over 2 MiB or invalid snapshots return no inspector.

Missing configuration, database failure, deleted/pruned executions, and unsupported snapshots return `null`. The web then labels its checked-in workflow and observed API receipts accordingly. The inspector's read connection and polling are separate from assessment processing; observer failure does not stop a run. Persist and back up the n8n database, and choose n8n execution retention for the demo's needs. [n8n execution settings](https://docs.n8n.io/hosting/configuration/environment-variables/executions/) describe progress saving and pruning.
