import { preparedRequirements, type Requirement } from './requirements.js';
import type { AssessmentToSave } from './assessment.js';

export type ImplementationStep = {
  questionId: string;
  readiness: 'ready' | 'needs_evidence' | 'blocked';
  action: string;
};

const steps = [
  {
    questionId: 'employee-saml-sign-in',
    actions: {
      supported: 'Plan employee SAML 2.0 sign-in using the cited product capability.',
      unsupported: 'Plan an alternative employee sign-in approach; do not promise SAML 2.0.',
      unknown: 'Request documentation confirming employee SAML 2.0 sign-in before committing.',
    },
  },
  {
    questionId: 'https-account-event-webhook',
    actions: {
      supported:
        'Plan account-event delivery to Northstar’s HTTPS endpoint using the cited product capability.',
      unsupported:
        'Plan another event-delivery approach; do not promise an HTTPS account-event webhook.',
      unknown:
        'Request documentation confirming account-event delivery to an HTTPS webhook before committing.',
    },
  },
  {
    questionId: 'first-attempt-60-seconds',
    actions: {
      supported: 'Document the cited 60-second first-attempt guarantee as an acceptance criterion.',
      unsupported: 'Remove the 60-second promise and agree on a documented delivery expectation.',
      unknown: 'Obtain a documented first-attempt delivery guarantee before promising 60 seconds.',
    },
  },
] as const;

const readiness = {
  supported: 'ready',
  unsupported: 'blocked',
  unknown: 'needs_evidence',
} as const;

export function buildImplementationPath(
  assessments: readonly Pick<AssessmentToSave, 'questionId' | 'verdict'>[],
  requirements: readonly Requirement[] = preparedRequirements,
): ImplementationStep[] {
  const byQuestion = new Map(assessments.map((assessment) => [assessment.questionId, assessment]));
  if (assessments.length !== requirements.length || byQuestion.size !== requirements.length) {
    throw new Error('Implementation path needs all distinct submitted assessments');
  }
  return requirements.map(({ id: questionId, question }) => {
    const actions = steps.find((step) => step.questionId === questionId)?.actions ?? {
      supported: `Plan implementation using the cited capability for: ${question}`,
      unsupported: `Do not commit to this requirement; agree on an alternative: ${question}`,
      unknown: `Obtain documentation establishing this requirement before committing: ${question}`,
    };
    const assessment = byQuestion.get(questionId);
    if (!assessment) {
      throw new Error('Implementation path is missing a submitted assessment');
    }
    return {
      questionId,
      readiness: readiness[assessment.verdict],
      action: actions[assessment.verdict],
    };
  });
}
