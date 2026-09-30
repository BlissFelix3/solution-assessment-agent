import type { RunTrace, TraceEvent, TraceStage } from './api.js';

export const repositoryUrl = 'https://github.com/BlissFelix3/solution-assessment-agent';
export const requirements = [
  { id: 'employee-saml-sign-in', label: 'Employee SSO', question: 'Can employees sign in with SAML 2.0?' },
  {
    id: 'https-account-event-webhook',
    label: 'Event delivery',
    question: 'Can our HTTPS webhook receive account events from the platform?',
  },
  {
    id: 'first-attempt-60-seconds',
    label: '60-second guarantee',
    question: 'Is the first account-event webhook delivery attempt guaranteed within 60 seconds?',
  },
];

export type NodeId = TraceStage | 'sources';
export type FlowNode = {
  id: NodeId;
  number: string;
  title: string;
  technology: string;
  caption: string;
  description: string;
  file: string;
  x: number;
  y: number;
};
export const nodes: FlowNode[] = [
  {
    id: 'webhook',
    number: '01',
    title: 'Webhook handoff',
    technology: 'HTTP / 202',
    caption: 'Admit → authenticate → dispatch',
    x: 35,
    y: 65,
    description:
      'The public API reserves a place in the hourly demo allowance, then calls the authenticated n8n webhook. A 202 response returns a run ID while work continues. Both access tokens stay on the server.',
    file: 'apps/api/src/demo-runs.service.ts',
  },
  {
    id: 'workflow',
    number: '02',
    title: 'Orchestrate',
    technology: 'n8n',
    caption: 'One execution · three requirements',
    x: 365,
    y: 65,
    description:
      'n8n creates a run, prepares three requirements, calls the assessment API, checks the saved results, builds the dossier, and completes the run. A failed assessment call retries once. These events are recorded at API boundaries; they are not an n8n node debugger.',
    file: 'n8n/complete-assessment.json',
  },
  {
    id: 'sources',
    number: 'DB',
    title: 'Pin the evidence',
    technology: 'POSTGRESQL',
    caption: 'Immutable document revision',
    x: 695,
    y: 65,
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
    x: 35,
    y: 275,
    description:
      'The prepared question becomes an English full-text query. PostgreSQL ranks matching documents with ts_rank_cd and selects up to five from the pinned revision. The recorded candidates below are the actual model context for this attempt. This implementation uses keyword retrieval.',
    file: 'apps/api/src/runs.repository.ts',
  },
  {
    id: 'generation',
    number: '04',
    title: 'Generate',
    technology: 'GEMINI',
    caption: 'Question + context → JSON',
    x: 255,
    y: 275,
    description:
      'Gemini receives the requirement, retrieved documents, evidence rules, and a structured response schema. It proposes supported, unsupported, or unknown. Unknown means the documents do not establish an answer; the run can still succeed.',
    file: 'apps/api/src/assessment.model.ts',
  },
  {
    id: 'validation',
    number: '05',
    title: 'Validate',
    technology: 'TYPESCRIPT',
    caption: 'Shape · verdict · exact quotes',
    x: 475,
    y: 275,
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
    x: 695,
    y: 275,
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
    x: 365,
    y: 465,
    description:
      'After all three assessments are present, ordinary application code maps their verdicts into an implementation path. Supported becomes ready, unknown needs evidence, and unsupported is blocked. This step makes no additional model call.',
    file: 'apps/api/src/implementation-path.ts',
  },
  {
    id: 'completion',
    number: '08',
    title: 'Close execution',
    technology: 'n8n → API',
    caption: 'Verify outputs · record outcome',
    x: 695,
    y: 465,
    description:
      'The database permits completion only when all three assessments and a dossier exist. The n8n error workflow records failed executions. Pending runs older than ten minutes are displayed as timed out until an outcome is reported.',
    file: 'apps/api/src/runs.repository.ts',
  },
];

export function eventsFor(trace: RunTrace | null, node: NodeId, questionId: string): TraceEvent[] {
  if (!trace) return [];
  if (node === 'sources') {
    return trace.events.filter((event) => event.stage === 'workflow' && event.status === 'succeeded');
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
