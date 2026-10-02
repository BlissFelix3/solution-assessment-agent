import { AssessmentError } from './errors.js';

export type Requirement = { id: string; label: string; question: string };

export const preparedRequirements: Requirement[] = [
  {
    id: 'employee-saml-sign-in',
    label: 'Employee SSO',
    question: 'Can employees sign in with SAML 2.0?',
  },
  {
    id: 'https-account-event-webhook',
    label: 'Event delivery',
    question: 'Can our HTTPS webhook receive account events from the platform?',
  },
  {
    id: 'first-attempt-60-seconds',
    label: '60-second guarantee',
    question: 'Is the first account-event webhook delivery attempt guaranteed within 60 seconds?',
  },
];

export function parseRequirements(value: unknown): Requirement[] {
  if (value === undefined) return preparedRequirements;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 3 ||
    !value.every(
      (question): question is string =>
        typeof question === 'string' && question.trim().length > 0 && question.length <= 500,
    )
  ) {
    throw new AssessmentError(
      'invalid_input',
      'Submit one to three requirements, each between 1 and 500 characters',
    );
  }
  const questions = value.map((question) => question.trim());
  if (new Set(questions.map((question) => question.toLowerCase())).size !== questions.length) {
    throw new AssessmentError('invalid_input', 'Submit distinct requirements');
  }
  return questions.map((question, index) => ({
    id: `requirement-${index + 1}`,
    label: `Requirement ${index + 1}`,
    question,
  }));
}
