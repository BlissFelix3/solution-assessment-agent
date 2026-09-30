import { readFile, writeFile } from 'node:fs/promises';

const runId = process.argv[2];
if (!runId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
  throw new Error('Usage: node apps/web/scripts/record-execution.mjs <completed-run-uuid>');
}
const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const [trace, progress] = await Promise.all(
  ['trace', 'assessments'].map(async (resource) => {
    const response = await fetch(`${baseUrl}/runs/${runId}/${resource}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Could not read ${resource}: HTTP ${response.status}`);
    return response.json();
  }),
);
if (
  trace.runId !== runId ||
  progress.runId !== runId ||
  trace.sourceRevisionId !== progress.sourceRevisionId ||
  trace.status !== 'completed' ||
  progress.status !== 'completed' ||
  !Array.isArray(trace.events) ||
  trace.events.length === 0
) {
  throw new Error('Only a completed run with recorded execution evidence can be exported');
}
// Public recordings must contain only the fictional documents shipped with this project.
for (const event of trace.events) {
  for (const source of event.data.candidates ?? event.data.sources ?? []) {
    if (!/^[a-z-]+\.md$/.test(source.path)) throw new Error('Unexpected source path');
    const fixture = await readFile(
      new URL(`../../../fixtures/sources/${source.path}`, import.meta.url),
      'utf8',
    );
    if (fixture !== source.content) throw new Error(`Non-fixture content in ${source.path}`);
  }
}
await writeFile(
  new URL('../public/recorded-execution.json', import.meta.url),
  `${JSON.stringify({ trace, progress }, null, 2)}\n`,
);
console.log(`Recorded execution ${runId}: ${trace.events.length} events`);
