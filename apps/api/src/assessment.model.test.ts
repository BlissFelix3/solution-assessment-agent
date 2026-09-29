import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { AssessmentModel } from './assessment.model.js';

const question = 'Can employees sign in with SAML 2.0?';
const sources = [{ path: 'authentication.md', content: 'Employees can sign in with SAML 2.0.' }];

function useTestKey(t: TestContext): void {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  t.after(() => {
    if (previousKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousKey;
    }
  });
}

test('sends the prepared question and retrieved sources for structured assessment', async (t) => {
  useTestKey(t);
  const expected = {
    verdict: 'supported',
    explanation: 'SAML sign-in is documented.',
    basis: [{ path: 'authentication.md', quote: sources[0]!.content }],
    notProof: [],
    missingEvidence: null,
  };
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'test-key');
    assert.equal(init?.method, 'POST');
    assert(typeof init?.body === 'string');
    const request: unknown = JSON.parse(init.body);
    assert(request !== null && typeof request === 'object' && 'contents' in request);
    assert.deepEqual(request.contents, [
      { role: 'user', parts: [{ text: JSON.stringify({ question, sources }) }] },
    ]);
    assert('generationConfig' in request);
    assert.match(JSON.stringify(request.generationConfig), /"mimeType":"APPLICATION_JSON"/);
    assert.match(JSON.stringify(request.generationConfig), /"thinkingBudget":1024/);
    return Response.json({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(expected) }] } }],
    });
  });

  assert.deepEqual(await new AssessmentModel().generate(question, sources), expected);
});

test('rejects an incomplete model response', async (t) => {
  useTestKey(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }],
  }));

  await assert.rejects(new AssessmentModel().generate(question, sources), /no complete assessment/);
});

test('reports provider failure without exposing its response body', async (t) => {
  useTestKey(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'provider details' }, { status: 429 }));

  await assert.rejects(new AssessmentModel().generate(question, sources), {
    message: 'Model request failed (429)',
  });
});
