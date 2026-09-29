type SourceQuote = { path: string; quote: string };
type NotProofQuote = SourceQuote & { reason: string };

export type Assessment = {
  questionId: string;
  explanation: string;
  notProof: NotProofQuote[];
} & (
  | { verdict: 'unknown'; basis: []; missingEvidence: string }
  | { verdict: 'supported' | 'unsupported'; basis: SourceQuote[]; missingEvidence: null }
);

export type RunProgress = {
  status: 'pending' | 'completed' | 'failed' | 'timed_out';
  assessments: Assessment[];
  implementationPath: ImplementationStep[] | null;
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

export async function startDemo(): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/runs/demo', { method: 'POST', signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error('We could not confirm whether the review started. Please wait before trying again.');
  }
  if (response.status === 429) {
    throw new Error('The public demo is at capacity. Please try again later.');
  }
  if (!response.ok) {
    throw new Error('We could not confirm whether the review started. Please wait before trying again.');
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('The review returned an invalid response. Please wait before trying again.');
  }
  if (!value || typeof value !== 'object' ||
    !('runId' in value) || typeof value.runId !== 'string' || value.runId.length === 0) {
    throw new Error('The review returned no run ID. Please wait before trying again.');
  }
  return value.runId;
}

export async function getRunProgress(runId: string, signal: AbortSignal): Promise<RunProgress> {
  let response: Response;
  try {
    response = await fetch(`/runs/${encodeURIComponent(runId)}/assessments`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
  } catch {
    throw new Error('Could not refresh the review status.');
  }
  if (!response.ok) {
    throw new Error('Could not refresh the review status.');
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('The review status response is invalid.');
  }
  if (!value || typeof value !== 'object' ||
    !('runId' in value) || value.runId !== runId ||
    !('status' in value) || !isRunStatus(value.status) ||
    !('assessments' in value) || !Array.isArray(value.assessments) ||
    !('implementationPath' in value) ||
    value.assessments.length > 3 ||
    (value.status === 'completed' && value.assessments.length !== 3)) {
    throw new Error('The review status response is invalid.');
  }
  const assessments: unknown[] = value.assessments;
  if (!assessments.every(isAssessment)) {
    throw new Error('The review status response is invalid.');
  }
  let implementationPath: ImplementationStep[] | null;
  if (value.implementationPath === null) {
    implementationPath = null;
  } else if (Array.isArray(value.implementationPath) &&
    value.implementationPath.length === 3 &&
    value.implementationPath.every(isImplementationStep)) {
    implementationPath = value.implementationPath;
  } else {
    throw new Error('The review status response is invalid.');
  }
  if ((value.status === 'completed' && implementationPath === null) ||
    (implementationPath !== null && (
      new Set(implementationPath.map((step) => step.questionId)).size !== 3 ||
      implementationPath.some((step) => !assessments.some((item) => item.questionId === step.questionId))
    ))) {
    throw new Error('The review status response is invalid.');
  }
  return { status: value.status, assessments, implementationPath };
}

export async function getSource(runId: string, path: string, signal: AbortSignal): Promise<SourceDocument> {
  let response: Response;
  try {
    response = await fetch(`/runs/${encodeURIComponent(runId)}/sources?path=${encodeURIComponent(path)}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
  } catch {
    throw new Error('Could not open the source document.');
  }
  if (!response.ok) {
    throw new Error(response.status === 404
      ? 'This source is unavailable for this review.'
      : 'Could not open the source document.');
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('The source document response is invalid.');
  }
  if (!isRecord(value) || !isNonBlank(value.sourceRevisionId) ||
    value.path !== path || typeof value.content !== 'string') {
    throw new Error('The source document response is invalid.');
  }
  return { sourceRevisionId: value.sourceRevisionId, path: value.path, content: value.content };
}

function isRunStatus(value: unknown): value is RunProgress['status'] {
  return value === 'pending' || value === 'completed' || value === 'failed' || value === 'timed_out';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSourceQuote(value: unknown): value is SourceQuote {
  return isRecord(value) && isNonBlank(value.path) && isNonBlank(value.quote);
}

function isNotProofQuote(value: unknown): value is NotProofQuote {
  return isRecord(value) && isNonBlank(value.path) && isNonBlank(value.quote) &&
    isNonBlank(value.reason);
}

function isImplementationStep(value: unknown): value is ImplementationStep {
  return isRecord(value) && isNonBlank(value.questionId) && isNonBlank(value.action) &&
    (value.readiness === 'ready' || value.readiness === 'needs_evidence' || value.readiness === 'blocked');
}

function isAssessment(value: unknown): value is Assessment {
  if (!isRecord(value) || !isNonBlank(value.questionId) || !isNonBlank(value.explanation) ||
    !Array.isArray(value.basis) || !value.basis.every(isSourceQuote) ||
    !Array.isArray(value.notProof) || !value.notProof.every(isNotProofQuote)) {
    return false;
  }
  if (value.verdict === 'unknown') {
    return value.basis.length === 0 && isNonBlank(value.missingEvidence);
  }
  return (value.verdict === 'supported' || value.verdict === 'unsupported') &&
    value.basis.length > 0 && value.missingEvidence === null;
}
