import type { RunProgress, RunTrace, TraceEvent, TraceStage } from './api.js';

export const repositoryUrl = 'https://github.com/BlissFelix3/solution-assessment-agent';

export type NodeId = TraceStage | 'sources';
export type FlowNode = {
  id: NodeId;
  number: string;
  title: string;
  technology: string;
  caption: string;
  description: string;
  file: string;
};
export const nodes: FlowNode[] = [
  {
    id: 'webhook',
    number: '01',
    title: 'Webhook handoff',
    technology: 'HTTP / 202',
    caption: 'Admit → authenticate → dispatch',
    description:
      'The public API reserves a place in the hourly demo allowance, then calls the authenticated n8n webhook. A 202 response returns a run ID while work continues. Both access tokens stay on the server.',
    file: 'apps/api/src/demo-runs.service.ts',
  },
  {
    id: 'workflow',
    number: '02',
    title: 'n8n orchestration',
    technology: 'n8n',
    caption: 'One execution · submitted requirements',
    description:
      'n8n creates a run, prepares the submitted requirements, calls the assessment API, checks the saved results, builds the dossier, and completes the run. A failed assessment call retries once. These events are recorded at API boundaries; they are not an n8n node debugger.',
    file: 'n8n/complete-assessment.json',
  },
  {
    id: 'sources',
    number: 'DB',
    title: 'Pin the evidence',
    technology: 'POSTGRESQL',
    caption: 'Immutable document revision',
    description:
      'A run keeps the source revision that was active when it started. Every retrieval and citation uses that same immutable revision, even if a later run uses newer documents.',
    file: 'apps/api/migrations/002_immutable_sources.sql',
  },
  {
    id: 'retrieval',
    number: '03',
    title: 'Retrieve',
    technology: 'POSTGRESQL FTS',
    caption: 'Rank documents · return top 5',
    description:
      'The submitted question becomes an English full-text query. PostgreSQL ranks matching documents with ts_rank_cd and selects up to five from the pinned revision. The recorded candidates below are the actual model context for this attempt. This implementation uses keyword retrieval.',
    file: 'apps/api/src/runs.repository.ts',
  },
  {
    id: 'generation',
    number: '04',
    title: 'Generate',
    technology: 'AI MODEL',
    caption: 'Question + context → JSON',
    description:
      'The configured model receives the requirement, retrieved documents, evidence rules, and a structured response schema. It proposes supported, unsupported, or unknown. Unknown means the documents do not establish an answer; the run can still succeed.',
    file: 'apps/api/src/assessment.model.ts',
  },
  {
    id: 'validation',
    number: '05',
    title: 'Validate',
    technology: 'TYPESCRIPT',
    caption: 'Shape · verdict · exact quotes',
    description:
      'Application code validates the output shape, verdict rules, document paths, and exact quote membership before saving. These checks detect malformed or invented citations. They do not prove that a quote logically supports a claim.',
    file: 'apps/api/src/assessment.ts',
  },
  {
    id: 'persistence',
    number: '06',
    title: 'Persist',
    technology: 'POSTGRESQL',
    caption: 'Unique run + requirement',
    description:
      'Validated assessments are saved under a unique run and question pair. If a response is lost and n8n retries, an existing saved assessment is returned without another model call. State-changing writes and their success events commit together.',
    file: 'apps/api/src/runs.repository.ts',
  },
  {
    id: 'dossier',
    number: '07',
    title: 'Assemble dossier',
    technology: 'DETERMINISTIC',
    caption: 'Saved verdicts → next steps',
    description:
      'After all submitted assessments are present, ordinary application code maps their verdicts into an implementation path. Supported becomes ready, unknown needs evidence, and unsupported is blocked. This step makes no additional model call.',
    file: 'apps/api/src/implementation-path.ts',
  },
  {
    id: 'completion',
    number: '08',
    title: 'Close execution',
    technology: 'n8n → API',
    caption: 'Verify outputs · record outcome',
    description:
      'The database permits completion only when all submitted assessments and a dossier exist. The n8n error workflow records failed executions. Pending runs older than ten minutes are displayed as timed out until an outcome is reported.',
    file: 'apps/api/src/runs.repository.ts',
  },
];

export function eventsFor(trace: RunTrace | null, node: NodeId, questionId: string): TraceEvent[] {
  if (!trace) return [];
  if (node === 'sources') {
    return trace.events.filter(
      (event) => event.stage === 'workflow' && event.status === 'succeeded',
    );
  }
  return trace.events.filter(
    (event) => event.stage === node && (!event.questionId || event.questionId === questionId),
  );
}

export function nodeStatus(trace: RunTrace | null, node: NodeId, questionId: string) {
  if (node === 'workflow' && trace) {
    if (trace.status === 'failed') return 'failed';
    if (trace.status === 'completed') return 'succeeded';
    if (trace.status === 'timed_out') return 'unconfirmed';
    return trace.events.some((event) => event.stage === 'workflow') ? 'started' : 'waiting';
  }
  const event = eventsFor(trace, node, questionId).at(-1);
  if (!event) return 'waiting';
  if (event.status === 'started' && trace?.status !== 'pending') return 'unconfirmed';
  return event.status;
}

export function elapsed(start: string, end: string): string {
  const milliseconds = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

// Playback exposes only evidence available at its current recorded event.
export function replayExecution(trace: RunTrace, progress: RunProgress, count: number) {
  const events = trace.events.slice(0, Math.max(0, count));
  const status = events.length === trace.events.length ? trace.status : 'pending';
  return {
    trace: { ...trace, events, status },
    progress: {
      ...progress,
      status,
      assessments: progress.assessments.filter((assessment) =>
        events.some(
          (event) =>
            event.stage === 'persistence' &&
            event.status === 'succeeded' &&
            event.questionId === assessment.questionId,
        ),
      ),
      implementationPath: events.some(
        (event) => event.stage === 'dossier' && event.status === 'succeeded',
      )
        ? progress.implementationPath
        : null,
    },
  };
}

export function executionMessage(trace: RunTrace | null, starting: boolean): string {
  if (!trace) return starting ? 'Sending your question to n8n…' : 'See how your answer is built';
  if (trace.status === 'completed') return 'Assessment complete';
  if (trace.status === 'failed') return 'The workflow stopped. Inspect the receipts below.';
  if (trace.status === 'timed_out') return 'The workflow has not reported an outcome.';
  const latest = trace.events.at(-1);
  if (latest?.status === 'failed') return 'An attempt failed. Inspect the execution receipts.';
  const started = latest?.status === 'started';
  switch (latest?.stage) {
    case 'retrieval':
      return started ? 'Retrieving relevant documentation…' : 'Retrieved documentation';
    case 'generation':
      return started ? 'Reading the evidence and generating an answer…' : 'Answer generated';
    case 'validation':
      return started ? 'Checking citations against the source documents…' : 'Citations checked';
    case 'persistence':
      return started ? 'Saving the assessment…' : 'Assessment saved';
    default:
      return 'Waiting for the next workflow event…';
  }
}
// Highlight only nodes whose API calls have receipts. Code nodes have no telemetry here.
export function n8nNodeStatus(trace: RunTrace | null, name: string, questionId: string) {
  if (!trace) return undefined;
  if (name === 'Create run')
    return trace.events.find(
      (event) => event.stage === 'workflow' && event.status === 'succeeded',
    )?.status;
  const stage =
    name === 'Return run ID'
      ? 'webhook'
      : name === 'Create dossier'
        ? 'dossier'
        : name === 'Complete run'
          ? 'completion'
          : undefined;
  if (stage) return eventsFor(trace, stage, questionId).at(-1)?.status;
  if (name !== 'Assess requirement') return undefined;
  const event = trace.events
    .filter(
      (item) =>
        item.questionId === questionId &&
        ['retrieval', 'generation', 'validation', 'persistence'].includes(item.stage),
    )
    .at(-1);
  if (!event) return undefined;
  if (event.status === 'failed') return 'failed';
  if (event.stage === 'persistence' && event.status === 'succeeded') return 'succeeded';
  return trace.status === 'pending' ? 'started' : 'unconfirmed';
}
