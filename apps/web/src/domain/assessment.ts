export type Requirement = { id: string; label: string; question: string };

export const requirements: Requirement[] = [
  {
    id: 'employee-saml-sign-in',
    label: 'Employee SSO',
    question: 'Can employees sign in with SAML 2.0?',
  },
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

export type SourceQuote = { path: string; quote: string };
export type NotProofQuote = SourceQuote & { reason: string };

export type Assessment = {
  questionId: string;
  explanation: string;
  notProof: NotProofQuote[];
} & (
  | { verdict: 'unknown'; basis: []; missingEvidence: string }
  | { verdict: 'supported' | 'unsupported'; basis: SourceQuote[]; missingEvidence: null }
);

export type RunProgress = {
  requirements: Requirement[];
  status: 'pending' | 'completed' | 'failed' | 'timed_out';
  assessments: Assessment[];
  implementationPath: ImplementationStep[] | null;
};

export type TraceStage =
  | 'workflow'
  | 'webhook'
  | 'retrieval'
  | 'generation'
  | 'validation'
  | 'persistence'
  | 'dossier'
  | 'completion';

export type TraceEvent = {
  id: string;
  stage: TraceStage;
  status: 'started' | 'succeeded' | 'failed';
  questionId: string | null;
  attemptId: string | null;
  createdAt: string;
  data: Record<string, unknown>;
};

export type RunTrace = {
  requirements: Requirement[];
  runId: string;
  executionId: string | null;
  sourceRevisionId: string;
  createdAt: string;
  status: RunProgress['status'];
  events: TraceEvent[];
};

export type ImplementationStep = {
  questionId: string;
  readiness: 'ready' | 'needs_evidence' | 'blocked';
  action: string;
};

export type SourceDocument = {
  sourceRevisionId: string;
  path: string;
  content: string;
};
