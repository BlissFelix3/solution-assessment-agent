import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRequirements, preparedRequirements } from './requirements.js';

test('bounds submitted requirements and assigns their identities on the server', () => {
  assert.deepEqual(parseRequirements(['  Can we export account events?  ']), [
    { id: 'requirement-1', label: 'Requirement 1', question: 'Can we export account events?' },
  ]);
  assert.deepEqual(parseRequirements(undefined), preparedRequirements);
  for (const value of [
    null,
    'question',
    [],
    [''],
    ['   '],
    [42],
    ['x'.repeat(501)],
    ['a', 'b', 'c', 'd'],
    ['Question', ' question '],
  ]) {
    assert.throws(() => parseRequirements(value));
  }
  assert.equal(parseRequirements(['x'.repeat(500)]).length, 1);
});
