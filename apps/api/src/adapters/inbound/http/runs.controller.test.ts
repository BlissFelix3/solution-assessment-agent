import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module.js';
import { RunsRepository } from '../../outbound/postgres/runs.repository.js';

test('preserves HTTP errors when application failures cross the inbound adapter', {
  skip: !process.env.TEST_DATABASE_URL,
}, async (t) => {
  const previous = { database: process.env.DATABASE_URL, token: process.env.INTERNAL_API_TOKEN };
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.INTERNAL_API_TOKEN = 'controller-test-token';
  t.after(() => {
    if (previous.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.database;
    if (previous.token === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous.token;
  });
  const app = await NestFactory.create(AppModule, { logger: false });
  const executionId = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  t.after(async () => {
    try {
      await app.get(RunsRepository).failExecution(executionId);
    } finally {
      await app.close();
    }
  });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();

  const invalid = await fetch(`${url}/runs/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requirements: [' '] }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).message, /one to three requirements/);

  const absent = await fetch(`${url}/runs/00000000-0000-4000-8000-000000000000/trace`);
  assert.equal(absent.status, 404);
  assert.equal((await absent.json()).message, 'Run not found');

  const unauthorized = await fetch(`${url}/runs`, { method: 'POST' });
  assert.equal(unauthorized.status, 401);

  const repository = app.get(RunsRepository);
  const run = await repository.create(executionId, [
    { id: 'requirement-1', label: 'Requirement 1', question: 'Can employees use SAML?' },
  ]);
  assert(run);
  const incomplete = await fetch(`${url}/runs/${run.id}/complete`, {
    method: 'POST',
    headers: { 'X-Internal-Token': 'controller-test-token' },
  });
  assert.equal(incomplete.status, 409);
  assert.equal((await incomplete.json()).message, 'Run is incomplete or failed');
});
