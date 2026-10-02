import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { AssessmentModel } from './assessment.model.js';
import { instruction, responseSchema } from '../../../application/assessment.prompt.js';
import type { ModelEvent } from '../../../application/ports/assessment-generator.js';

const question = 'Can employees sign in with SAML 2.0?';
const sources = [{ path: 'authentication.md', content: 'Employees can sign in with SAML 2.0.' }];
const expected = {
  verdict: 'supported',
  explanation: 'SAML sign-in is documented.',
  basis: [{ path: 'authentication.md', quote: sources[0]!.content }],
  notProof: [],
  missingEvidence: null,
};

function configure(t: TestContext, values: Record<string, string>) {
  for (const name of [
    'GROQ_API_KEY',
    'GROQ_MODEL',
    'CEREBRAS_API_KEY',
    'CEREBRAS_MODEL',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
  ]) {
    const previous = process.env[name];
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}
function chatResponse(content = JSON.stringify(expected), finish = 'stop') {
  return Response.json({ choices: [{ finish_reason: finish, message: { content } }] });
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  assert(typeof init?.body === 'string');
  const value: unknown = JSON.parse(init.body);
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

test('uses compact Groq model with only the question, retrieved sources and strict JSON schema', async (t) => {
  configure(t, { GROQ_API_KEY: 'private-test-key' });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-test-key');
    assert.equal(init?.method, 'POST');
    const request = requestBody(init);
    assert.equal(request.model, 'openai/gpt-oss-20b');
    assert.equal(request.reasoning_effort, 'low');
    assert.equal(request.max_completion_tokens, 2048);
    assert.deepEqual(request.messages, [
      { role: 'system', content: instruction },
      { role: 'user', content: JSON.stringify({ question, sources }) },
    ]);
    assert.deepEqual(request.response_format, {
      type: 'json_schema',
      json_schema: { name: 'assessment', strict: true, schema: responseSchema },
    });
    return chatResponse();
  });
  const events: ModelEvent[] = [];
  assert.deepEqual(
    await new AssessmentModel().generate(question, sources, async (event) => {
      events.push(event);
    }),
    expected,
  );
  assert.deepEqual(events, [{ provider: 'groq', model: 'openai/gpt-oss-20b', status: 'started' }]);
  assert.equal(JSON.stringify(events).includes('private-test-key'), false);
});

test('preserves Gemini-only environments and excludes thought parts from the assessment', async (t) => {
  configure(t, { GEMINI_API_KEY: 'test-key' });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(
      String(input),
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    );
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'test-key');
    const request = requestBody(init);
    assert.deepEqual(request.contents, [
      { role: 'user', parts: [{ text: JSON.stringify({ question, sources }) }] },
    ]);
    assert.match(JSON.stringify(request.generationConfig), /"thinkingBudget":1024/);
    return Response.json({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              { thought: true, text: 'internal reasoning' },
              { text: JSON.stringify(expected) },
            ],
          },
        },
      ],
    });
  });
  assert.deepEqual(await new AssessmentModel().generate(question, sources), expected);
});

test('falls back once per configured provider after a rate limit and records the actual model', async (t) => {
  configure(t, {
    GROQ_API_KEY: 'groq-key',
    CEREBRAS_API_KEY: 'cerebras-key',
    CEREBRAS_MODEL: 'configured-model',
  });
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    if (calls.length === 1)
      return Response.json({ error: 'private-provider-details' }, { status: 429 });
    assert.equal(requestBody(init).model, 'configured-model');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer cerebras-key');
    return chatResponse();
  });
  const events: ModelEvent[] = [];
  assert.deepEqual(
    await new AssessmentModel().generate(question, sources, async (event) => {
      events.push(event);
    }),
    expected,
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(
    events.map(({ provider, status }) => [provider, status]),
    [
      ['groq', 'started'],
      ['groq', 'failed'],
      ['cerebras', 'started'],
    ],
  );
  assert.equal(events.at(-1)?.model, 'configured-model');
  assert.equal(JSON.stringify(events).includes('private-provider-details'), false);
});

test('fails over after server or transport failures but does not repeat a provider call', async (t) => {
  configure(t, { GROQ_API_KEY: 'test', CEREBRAS_API_KEY: 'test', GEMINI_API_KEY: 'test' });
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    if (count === 1) return new Response('', { status: 503 });
    if (count === 2) throw new TypeError('private connection detail');
    return Response.json({
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(expected) }] } },
      ],
    });
  });
  assert.deepEqual(await new AssessmentModel().generate(question, sources), expected);
  assert.equal(count, 3);
});

test('permanent authentication failure does not silently switch to another provider', async (t) => {
  configure(t, { GROQ_API_KEY: 'test', CEREBRAS_API_KEY: 'test' });
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('private details', { status: 401 }),
  );
  await assert.rejects(new AssessmentModel().generate(question, sources), {
    message: 'Model request failed (401)',
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test('rejects truncated or malformed responses instead of treating them as unknown or falling back', async (t) => {
  configure(t, { GROQ_API_KEY: 'test', CEREBRAS_API_KEY: 'test' });
  const fetch = t.mock.method(globalThis, 'fetch', async () => chatResponse('{}', 'length'));
  await assert.rejects(new AssessmentModel().generate(question, sources), /no complete assessment/);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => chatResponse('not JSON'));
  await assert.rejects(
    new AssessmentModel().generate(question, sources),
    /invalid assessment JSON/,
  );
});

test('a timed-out request can fail over within the shared budget', async (t) => {
  configure(t, { GROQ_API_KEY: 'test', CEREBRAS_API_KEY: 'test' });
  let deadlines = 0;
  t.mock.method(AbortSignal, 'timeout', () => {
    deadlines++;
    return deadlines === 2 ? AbortSignal.abort() : new AbortController().signal;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    init?.signal?.throwIfAborted();
    return chatResponse();
  });
  const events: ModelEvent[] = [];
  assert.deepEqual(
    await new AssessmentModel().generate(question, sources, async (event) => {
      events.push(event);
    }),
    expected,
  );
  assert.equal(calls, 2);
  const failure = events[1];
  assert(failure?.status === 'failed');
  assert.equal(failure.reason, 'Model request timed out');
});

test('does not start another provider after the total generation deadline', async (t) => {
  configure(t, { GROQ_API_KEY: 'test', CEREBRAS_API_KEY: 'test' });
  const budget = new AbortController();
  let deadlines = 0;
  t.mock.method(AbortSignal, 'timeout', () =>
    ++deadlines === 1 ? budget.signal : new AbortController().signal,
  );
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    budget.abort();
    throw new Error('private timeout');
  });
  await assert.rejects(new AssessmentModel().generate(question, sources), {
    message: 'Model request timed out',
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test('explains exhausted rate limits without exposing provider response bodies', async (t) => {
  configure(t, { GROQ_API_KEY: 'test' });
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'private details' }, { status: 429 }),
  );
  await assert.rejects(new AssessmentModel().generate(question, sources), {
    message: 'Model provider rate limit reached',
  });
});

test('missing credentials fail before any external request', async (t) => {
  configure(t, {});
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected request');
  });
  await assert.rejects(new AssessmentModel().generate(question, sources), /Configure GROQ_API_KEY/);
  assert.equal(fetch.mock.callCount(), 0);
});
