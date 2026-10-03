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

type Candidate = { path: string; content: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function checkQuote(value: unknown, candidates: readonly Candidate[]): SourceQuote {
  if (!isRecord(value) || !isNonBlank(value.path) || !isNonBlank(value.quote)) {
    throw new Error('Model returned an invalid source quote');
  }
  const quote = value.quote;
  if (!candidates.some((candidate) => candidate.path === value.path && candidate.content.includes(quote))) {
    throw new Error('Model quote is absent from retrieved sources');
  }
  return { path: value.path, quote: value.quote };
}

export function validateAssessmentDraft(value: unknown, candidates: readonly Candidate[]): AssessmentDraft {
  if (!isRecord(value) || !isNonBlank(value.explanation)) {
    throw new Error('Model returned an invalid assessment');
  }
  const notProofInput = value.notProof === undefined ? [] : value.notProof;
  if (!Array.isArray(notProofInput)) {
    throw new Error('Model returned invalid non-supporting evidence');
  }
  const notProof = notProofInput.map((item: unknown) => {
    if (!isRecord(item) || !isNonBlank(item.reason)) {
      throw new Error('Model returned invalid non-supporting evidence');
    }
    return { ...checkQuote(item, candidates), reason: item.reason };
  });

  if (value.verdict === 'unknown') {
    if (
      !isNonBlank(value.missingEvidence) ||
      (value.basis !== undefined && (!Array.isArray(value.basis) || value.basis.length !== 0))
    ) {
      throw new Error('Unknown assessment needs missing evidence and no basis');
    }
    return {
      verdict: 'unknown',
      explanation: value.explanation,
      basis: [],
      notProof,
      missingEvidence: value.missingEvidence,
    };
  }

  if (value.verdict !== 'supported' && value.verdict !== 'unsupported') {
    throw new Error('Model returned an invalid verdict');
  }
  if (
    !Array.isArray(value.basis) ||
    value.basis.length === 0 ||
    (value.missingEvidence !== undefined && value.missingEvidence !== null)
  ) {
    throw new Error('Supported or unsupported assessment needs a basis');
  }
  return {
    verdict: value.verdict,
    explanation: value.explanation,
    basis: value.basis.map((quote: unknown) => checkQuote(quote, candidates)),
    notProof,
    missingEvidence: null,
  };
}
