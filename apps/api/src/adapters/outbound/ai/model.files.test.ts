import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { modelFile } from './model.files.js';

test('publishes only complete pinned assets and reuses the cache without another download', async (t) => {
  const cache = await mkdtemp(join(tmpdir(), 'assessment-model-assets-'));
  const previous = process.env.EMBEDDING_CACHE_DIR;
  process.env.EMBEDDING_CACHE_DIR = cache;
  t.after(async () => {
    if (previous === undefined) delete process.env.EMBEDDING_CACHE_DIR;
    else process.env.EMBEDDING_CACHE_DIR = previous;
    await rm(cache, { recursive: true, force: true });
  });
  const fetch = t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => {
    assert.equal(String(url), 'https://huggingface.co/test/model/resolve/fixed-revision/tokenizer.json');
    return new Response('{"complete":true}');
  });
  const filename = await modelFile('test/model', 'fixed-revision', 'tokenizer.json');
  assert.equal(await readFile(filename, 'utf8'), '{"complete":true}');
  assert.equal(await modelFile('test/model', 'fixed-revision', 'tokenizer.json'), filename);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(await readdir(join(cache, 'test/model/fixed-revision')), ['tokenizer.json']);
  fetch.mock.mockImplementation(async () => new Response('incomplete', { headers: { 'content-length': String(40 * 1024 * 1024 + 1) } }));
  await assert.rejects(modelFile('test/model', 'fixed-revision', 'oversized.onnx'), /unexpected size/);
  fetch.mock.mockImplementation(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1])); controller.error(new Error('Disconnected')); },
  })));
  await assert.rejects(modelFile('test/model', 'fixed-revision', 'interrupted.onnx'), /Disconnected/);
  assert.deepEqual(await readdir(join(cache, 'test/model/fixed-revision')), ['tokenizer.json']);
});
