# Local assessment workflow

Start the API with a migrated, seeded database and `GEMINI_API_KEY` configured.

Import `complete-assessment.json` into n8n and run **Start locally**. This workflow was tested with n8n 2.39.10. Set **Set API URL** to the address where n8n can reach the API. The default is `http://127.0.0.1:3000` when both run on the same machine.

The workflow creates one run, assesses the three prepared requirements, verifies all three responses belong to that run, then reads the saved assessments. A failed API call stops the workflow. The assessment call retries once; the API returns an existing saved result if its first response was lost.

The final node outputs the saved assessment list and pinned source revision. The workflow has a manual trigger for local verification; public intake and execution reporting will be separate steps.
