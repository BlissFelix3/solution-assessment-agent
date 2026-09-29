export type RunProgress = {
  status: 'pending' | 'completed' | 'failed' | 'timed_out';
  assessmentCount: number;
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
    value.assessments.length > 3 ||
    (value.status === 'completed' && value.assessments.length !== 3)) {
    throw new Error('The review status response is invalid.');
  }
  return { status: value.status, assessmentCount: value.assessments.length };
}

function isRunStatus(value: unknown): value is RunProgress['status'] {
  return value === 'pending' || value === 'completed' || value === 'failed' || value === 'timed_out';
}
