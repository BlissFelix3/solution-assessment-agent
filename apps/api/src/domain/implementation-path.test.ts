import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImplementationPath } from './implementation-path.js';

const assessments = [
  { questionId: 'first-attempt-60-seconds', verdict: 'unknown' as const },
  { questionId: 'https-account-event-webhook', verdict: 'supported' as const },
  { questionId: 'employee-saml-sign-in', verdict: 'supported' as const },
];

test('orders a dossier path and leaves the unproven timing guarantee unresolved', () => {
  const path = buildImplementationPath(assessments);

  assert.deepEqual(path.map(({ questionId, readiness }) => ({ questionId, readiness })), [
    { questionId: 'employee-saml-sign-in', readiness: 'ready' },
    { questionId: 'https-account-event-webhook', readiness: 'ready' },
    { questionId: 'first-attempt-60-seconds', readiness: 'needs_evidence' },
  ]);
  assert.match(path[2]!.action, /before promising 60 seconds/);
});

test('does not propose implementing an explicitly unsupported requirement', () => {
  const path = buildImplementationPath([
    assessments[0]!,
    assessments[1]!,
    { questionId: 'employee-saml-sign-in', verdict: 'unsupported' },
  ]);

  assert.equal(path[0]!.readiness, 'blocked');
  assert.match(path[0]!.action, /do not promise SAML 2.0/);
});

test('refuses a path with a missing or repeated prepared assessment', () => {
  assert.throws(() => buildImplementationPath(assessments.slice(0, 2)), /all distinct/);
  assert.throws(() => buildImplementationPath([
    assessments[0]!, assessments[0]!, assessments[1]!,
  ]), /all distinct/);
});

test('builds a path for submitted requirements and rejects a foreign assessment', () => {
  const requirements = [
    { id: 'requirement-1', label: 'Requirement 1', question: 'Can we export events?' },
  ];
  const path = buildImplementationPath(
    [{ questionId: 'requirement-1', verdict: 'unknown' }],
    requirements,
  );
  assert.equal(path.length, 1);
  assert.equal(path[0]?.readiness, 'needs_evidence');
  assert.match(path[0]!.action, /Can we export events/);
  assert.throws(
    () => buildImplementationPath([{ questionId: 'foreign', verdict: 'supported' }], requirements),
    /missing/,
  );
});
