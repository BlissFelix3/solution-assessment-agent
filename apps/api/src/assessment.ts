export type SourceQuote = { path: string; quote: string };
export type NotProofQuote = SourceQuote & { reason: string };

export type AssessmentDraft = {
  verdict: 'supported' | 'unsupported' | 'unknown';
  explanation: string;
  basis: SourceQuote[];
  notProof: NotProofQuote[];
  missingEvidence: string | null;
};

export type AssessmentToSave = AssessmentDraft & {
  runId: string;
  questionId: string;
};

