export type AssessmentErrorCode = 'invalid_input' | 'not_found' | 'conflict' | 'unavailable' | 'capacity';

export class AssessmentError extends Error {
  constructor(readonly code: AssessmentErrorCode, message: string) {
    super(message);
    this.name = 'AssessmentError';
  }
}
