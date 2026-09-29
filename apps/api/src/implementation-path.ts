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
      supported: 'Plan account-event delivery to Northstar’s HTTPS endpoint using the cited product capability.',
      unsupported: 'Plan another event-delivery approach; do not promise an HTTPS account-event webhook.',
      unknown: 'Request documentation confirming account-event delivery to an HTTPS webhook before committing.',
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
): ImplementationStep[] {
  const byQuestion = new Map(assessments.map((assessment) => [assessment.questionId, assessment]));
  if (assessments.length !== steps.length || byQuestion.size !== steps.length) {
    throw new Error('Implementation path needs three distinct assessments');
  }
  return steps.map(({ questionId, actions }) => {
    const assessment = byQuestion.get(questionId);
    if (!assessment) {
      throw new Error('Implementation path is missing a prepared assessment');
    }
    return {
      questionId,
      readiness: readiness[assessment.verdict],
      action: actions[assessment.verdict],
    };
  });
}
