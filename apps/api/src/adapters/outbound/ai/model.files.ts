import { randomUUID } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function modelFile(model: string, revision: string, path: string): Promise<string> {
  const cacheDir = process.env.EMBEDDING_CACHE_DIR ??
    fileURLToPath(new URL('../../../../.cache/embeddings/', import.meta.url));
  const filename = join(cacheDir, model, revision, path);
  try {
    await stat(filename);
    return filename;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  const response = await fetch(`https://huggingface.co/${model}/resolve/${revision}/${path}`,
    { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Local model download failed (${response.status})`);
  const sizeLimit = 40 * 1024 * 1024;
  if (!response.body || Number(response.headers.get('content-length')) > sizeLimit) {
    throw new Error('Local model file has an unexpected size');
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > sizeLimit) {
        await reader.cancel();
        throw new Error('Local model file has an unexpected size');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new Error('Local model file has an unexpected size');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  await mkdir(dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filename);
  return filename;
}
