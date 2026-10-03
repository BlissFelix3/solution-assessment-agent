import { AssessmentError } from './errors.js';

export type CollectionId = 'northstar' | 'last-broadcast';
export type RetrievalMode = 'hybrid' | 'keyword';

export function parseCollection(value: unknown): CollectionId {
  if (value === undefined) return 'northstar';
  if (value === 'northstar' || value === 'last-broadcast') return value;
  throw new AssessmentError('invalid_input', 'Choose an available evidence collection');
}

export function parseRetrievalMode(value: unknown): RetrievalMode {
  if (value === undefined) return 'keyword';
  if (value === 'hybrid' || value === 'keyword') return value;
  throw new AssessmentError('invalid_input', 'Choose hybrid or keyword retrieval');
}
