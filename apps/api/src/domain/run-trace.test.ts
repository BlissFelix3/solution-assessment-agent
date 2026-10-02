import assert from 'node:assert/strict';
import test from 'node:test';
import { assessmentTraceData } from './run-trace.js';

test('keeps only assessment fields from untrusted model output', () => {
  assert.deepEqual(assessmentTraceData({
    verdict: 'supported', explanation: 'A cited capability.',
    basis: [{ path: 'sso.md', quote: 'SAML is supported.', metadata: 'private' }],
    notProof: [], missingEvidence: null, providerCredential: 'private',
  }), {
    verdict: 'supported', explanation: 'A cited capability.',
    basis: [{ path: 'sso.md', quote: 'SAML is supported.' }],
    notProof: [], missingEvidence: null,
  });
});

test('marks malformed model fields without copying arbitrary objects into the public trace', () => {
  assert.deepEqual(assessmentTraceData({
    explanation: { private: 'value' }, basis: [{ private: 'value' }, null],
  }), { explanation: { invalidShape: true }, basis: [{}, { invalidShape: true }] });
  assert.deepEqual(assessmentTraceData(null), { invalidShape: true });
});
