import { LocalTextEmbedder } from '../src/adapters/outbound/ai/text.embedder.js';
import { LocalEvidenceReranker } from '../src/adapters/outbound/ai/evidence.reranker.js';

const embedder = new LocalTextEmbedder();
const reranker = new LocalEvidenceReranker();
const content = 'The local models are ready to retrieve evidence.';
const started = performance.now();
try {
  await Promise.all([
    embedder.embed([content]),
    reranker.score('Are the local models ready?', [{
      id: 'readiness', path: 'readiness', content, startOffset: 0, endOffset: content.length,
    }]),
  ]);
  console.log(JSON.stringify({ embedding: embedder.identity, reranker: reranker.identity,
    cacheReady: true, durationMs: Math.round(performance.now() - started) }));
} finally {
  await Promise.all([embedder.dispose(), reranker.dispose()]);
}
