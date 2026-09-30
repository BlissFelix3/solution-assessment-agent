import { preparedRequirements } from './requirements.js';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HttpException } from '@nestjs/common';
import { Database } from './database.js';
import { DemoRunsService } from './demo-runs.service.js';
import { RunsRepository } from './runs.repository.js';

const run = {
  runId: '00000000-0000-4000-8000-000000000001',
  sourceRevisionId: 'fixture-v1',
};

function setup(t: TestContext) {
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    hourlyLimit: process.env.DEMO_RUNS_PER_HOUR,
    webhookUrl: process.env.N8N_START_WEBHOOK_URL,
    startToken: process.env.N8N_START_TOKEN,
    internalToken: process.env.INTERNAL_API_TOKEN,
  };
  process.env.DATABASE_URL = 'postgres://unused@localhost/unused';
  process.env.DEMO_RUNS_PER_HOUR = '4';
  process.env.N8N_START_WEBHOOK_URL = 'http://127.0.0.1:5688/webhook/solution-assessments';
  process.env.N8N_START_TOKEN = 'test-start-token';
  process.env.INTERNAL_API_TOKEN = 'test-internal-token';
  t.after(() => {
    for (const [key, value] of Object.entries({
      DATABASE_URL: previous.databaseUrl,
      DEMO_RUNS_PER_HOUR: previous.hourlyLimit,
      N8N_START_WEBHOOK_URL: previous.webhookUrl,
      N8N_START_TOKEN: previous.startToken,
      INTERNAL_API_TOKEN: previous.internalToken,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const database = new Database();
  t.after(() => database.onModuleDestroy());
  const repository = new RunsRepository(database);
  t.mock.method(repository, 'appendEvent', async () => {});
  return { repository, service: new DemoRunsService(repository) };
}

test('admits a fixed demo run and returns the n8n run identity', async (t) => {
  const { repository, service } = setup(t);
  const record = t.mock.method(repository, 'appendEvent', async () => {});
  const admit = t.mock.method(repository, 'admitDemoStart', async (limit: number) => {
    assert.equal(limit, 4);
    return true;
  });
  const request = t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), process.env.N8N_START_WEBHOOK_URL);
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('X-Demo-Token'), 'test-start-token');
    assert(init?.signal);
    return Response.json(run, { status: 202 });
  });

  assert.deepEqual(await service.start(), run);
  assert.equal(admit.mock.callCount(), 1);
  assert.equal(request.mock.callCount(), 1);
  assert.equal(record.mock.calls[0]?.arguments[0], run.runId);
  assert.equal(record.mock.calls[0]?.arguments[1]?.data.responseStatus, 202);
  assert.equal(JSON.stringify(record.mock.calls).includes('test-start-token'), false);
});

test('keeps the accepted run identity if its webhook acknowledgment cannot be recorded', async (t) => {
  const { repository, service } = setup(t);
  t.mock.method(repository, 'admitDemoStart', async () => true);
  t.mock.method(globalThis, 'fetch', async () => Response.json(run, { status: 202 }));
  t.mock.method(repository, 'appendEvent', async () => { throw new Error('Trace unavailable'); });

  assert.deepEqual(await service.start(), run);
});

test('rejects a start when the global allowance is full', async (t) => {
  const { repository, service } = setup(t);
  t.mock.method(repository, 'admitDemoStart', async () => false);
  const request = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('n8n must not be called');
  });

  await assert.rejects(service.start(), (error: unknown) =>
    error instanceof HttpException && error.getStatus() === 429);
  assert.equal(request.mock.callCount(), 0);
});

test('keeps the start closed without an hourly limit', async (t) => {
  const { repository, service } = setup(t);
  delete process.env.DEMO_RUNS_PER_HOUR;
  const admit = t.mock.method(repository, 'admitDemoStart', async () => true);

  await assert.rejects(service.start(), (error: unknown) =>
    error instanceof HttpException && error.getStatus() === 503);
  assert.equal(admit.mock.callCount(), 0);
});

test('does not expose an upstream error response', async (t) => {
  const { repository, service } = setup(t);
  t.mock.method(repository, 'admitDemoStart', async () => true);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ secret: 'upstream details' }, { status: 500 }));

  await assert.rejects(service.start(), (error: unknown) =>
    error instanceof HttpException && error.getStatus() === 503 &&
    !error.message.includes('upstream details'));
});

test('rejects invalid requirements before consuming admission or dispatching work', async (t) => {
  const { repository, service } = setup(t);
  const admit = t.mock.method(repository, 'admitDemoStart', async () => true);
  const request = t.mock.method(globalThis, 'fetch', async () =>
    Response.json(run, { status: 202 }),
  );
  await assert.rejects(service.start([' ']), /one to three requirements/);
  await assert.rejects(service.start(['same', 'Same']), /distinct/);
  assert.equal(admit.mock.callCount(), 0);
  assert.equal(request.mock.callCount(), 0);
});

test('forwards submitted questions through the authenticated webhook', async (t) => {
  const { repository, service } = setup(t);
  t.mock.method(repository, 'admitDemoStart', async () => true);
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), { requirements: ['Can we export events?'] });
    return Response.json(run, { status: 202 });
  });
  assert.deepEqual(await service.start([' Can we export events? ']), run);
});
