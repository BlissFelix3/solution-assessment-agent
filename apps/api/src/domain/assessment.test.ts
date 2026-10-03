import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateAssessmentDraft } from './assessment.js';

const content = await readFile(
  new URL('../../../../fixtures/sources/webhook-delivery-log.md', import.meta.url),
  'utf8',
);
const candidates = [{ path: 'webhook-delivery-log.md', content }];
const dashboardQuote = 'The dashboard refreshes delivery counts every 60 seconds.';

test('accepts a Supported result with a quote from a retrieved document', async () => {
  const authentication = await readFile(
    new URL('../../../../fixtures/sources/authentication.md', import.meta.url),
    'utf8',
  );
  const quote = 'Employees can sign in with SAML 2.0.';
  const result = validateAssessmentDraft({
    verdict: 'supported',
    explanation: 'SAML sign-in is documented.',
    basis: [{ path: 'authentication.md', quote }],
  }, [{ path: 'authentication.md', content: authentication }]);
  assert.deepEqual(result.basis, [{ path: 'authentication.md', quote }]);
  assert.deepEqual(result.notProof, []);
  assert.equal(result.missingEvidence, null);
});

test('accepts an Unknown result that explains why a retrieved quote is not proof', () => {
  const result = validateAssessmentDraft({
    verdict: 'unknown',
    explanation: 'No first-attempt deadline is documented.',
    missingEvidence: 'A first-attempt delivery guarantee within 60 seconds.',
    notProof: [{ path: 'webhook-delivery-log.md', quote: dashboardQuote, reason: 'This describes dashboard refreshes.' }],
    runId: 'model-supplied-id',
  }, candidates);
  assert.equal(result.verdict, 'unknown');
  assert.deepEqual(result.basis, []);
  assert.equal(result.notProof[0]?.quote, dashboardQuote);
  assert(!('runId' in result));
});

test('rejects a quote that is absent from the retrieved source', () => {
  assert.throws(() => validateAssessmentDraft({
    verdict: 'supported',
    explanation: 'The first attempt is guaranteed within 60 seconds.',
    basis: [{ path: 'webhook-delivery-log.md', quote: 'The first attempt is guaranteed within 60 seconds.' }],
    notProof: [],
  }, candidates), /absent from retrieved sources/);
});

test('rejects a fabricated non-supporting quote', () => {
  assert.throws(() => validateAssessmentDraft({
    verdict: 'unknown',
    explanation: 'No first-attempt deadline is documented.',
    missingEvidence: 'A first-attempt delivery guarantee within 60 seconds.',
    notProof: [{
      path: 'webhook-delivery-log.md',
      quote: 'The first attempt always happens within 60 seconds.',
      reason: 'This is about dashboard refreshes.',
    }],
  }, candidates), /absent from retrieved sources/);
});

test('rejects a quote from a document outside the retrieval results', () => {
  assert.throws(() => validateAssessmentDraft({
    verdict: 'supported',
    explanation: 'The dashboard refreshes every 60 seconds.',
    basis: [{ path: 'webhooks.md', quote: dashboardQuote }],
    notProof: [],
  }, candidates), /absent from retrieved sources/);
});

test('rejects verdict shapes that cannot be saved', () => {
  assert.throws(() => validateAssessmentDraft({
    verdict: 'unknown',
    explanation: 'No guarantee is documented.',
    missingEvidence: 'A first-attempt guarantee.',
    basis: [{ path: 'webhook-delivery-log.md', quote: dashboardQuote }],
    notProof: [],
  }, candidates), /no basis/);
  assert.throws(() => validateAssessmentDraft({
    verdict: 'supported',
    explanation: 'It is supported.',
    basis: [],
    notProof: [],
  }, candidates), /needs a basis/);
});

test('accepts a quote from a later retrieved chunk of the same document', () => {
  const result = validateAssessmentDraft({
    verdict: 'supported', explanation: 'The archived recording survived.',
    basis: [{ path: 'inventory.md', quote: 'The digest matched.' }],
  }, [
    { path: 'inventory.md', content: 'The production path is empty.' },
    { path: 'inventory.md', content: 'The archive copy was verified. The digest matched.' },
  ]);
  assert.equal(result.basis[0]?.quote, 'The digest matched.');
});

test('rejects a quote constructed across separate retrieved chunks', () => {
  assert.throws(() => validateAssessmentDraft({
    verdict: 'supported', explanation: 'A joined quote is not an exact retrieved passage.',
    basis: [{ path: 'inventory.md', quote: 'The digest matched. The archive copy was verified.' }],
  }, [
    { path: 'inventory.md', content: 'The digest matched.' },
    { path: 'inventory.md', content: 'The archive copy was verified.' },
  ]), /absent from retrieved sources/);
});
