export type RunEvent = {
  stage: 'workflow' | 'webhook' | 'retrieval' | 'generation' | 'validation' |
    'persistence' | 'dossier' | 'completion';
  status: 'started' | 'succeeded' | 'failed';
  questionId: string | null;
  attemptId: string | null;
  data: Record<string, unknown>;
};

// Provider output is untrusted: keep assessment fields, never arbitrary metadata.
export function assessmentTraceData(draft: unknown): Record<string, unknown> {
  if (typeof draft !== 'object' || draft === null || Array.isArray(draft)) {
    return { invalidShape: true };
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (['verdict', 'explanation', 'missingEvidence'].includes(key)) {
      result[key] = typeof value === 'string' || value === null ? value : { invalidShape: true };
    } else if (key === 'basis' || key === 'notProof') {
      result[key] = Array.isArray(value) ? value.map((item: unknown) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          return { invalidShape: true };
        }
        return Object.fromEntries(Object.entries(item).filter(([field, text]) =>
          ['path', 'quote', 'reason'].includes(field) && typeof text === 'string'));
      }) : { invalidShape: true };
    }
  }
  return result;
}
