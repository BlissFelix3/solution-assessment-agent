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
