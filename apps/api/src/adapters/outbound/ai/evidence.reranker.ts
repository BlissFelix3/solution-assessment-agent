import { Tokenizer } from '@huggingface/tokenizers';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import { readFile } from 'node:fs/promises';
import type { EvidenceReranker } from '../../../application/ports/evidence-reranker.js';
import type { RerankerIdentity, SourceChunk } from '../../../domain/retrieval.js';
import { modelFile } from './model.files.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class LocalEvidenceReranker implements EvidenceReranker {
  readonly identity: RerankerIdentity = {
    model: 'Xenova/ms-marco-MiniLM-L-6-v2',
    revision: 'a09144355adeed5f58c8ed011d209bf8ee5a1fec',
    dtype: 'q8',
  };
  private model: Promise<{ tokenizer: Tokenizer; session: InferenceSession }> | null = null;

  private async load() {
    const [modelPath, tokenizerPath, configPath] = await Promise.all([
      modelFile(this.identity.model, this.identity.revision, 'onnx/model_quantized.onnx'),
      modelFile(this.identity.model, this.identity.revision, 'tokenizer.json'),
      modelFile(this.identity.model, this.identity.revision, 'tokenizer_config.json'),
    ]);
    const tokenizerJson: unknown = JSON.parse(await readFile(tokenizerPath, 'utf8'));
    const tokenizerConfig: unknown = JSON.parse(await readFile(configPath, 'utf8'));
    if (!isRecord(tokenizerJson) || !isRecord(tokenizerConfig)) {
      throw new Error('Reranker returned invalid tokenizer files');
    }
    return {
      tokenizer: new Tokenizer(tokenizerJson, tokenizerConfig),
      session: await InferenceSession.create(modelPath, { intraOpNumThreads: 2 }),
    };
  }

  async score(question: string, chunks: readonly SourceChunk[]): Promise<number[]> {
    if (chunks.length === 0) return [];
    if (question.trim().length === 0 || chunks.length > 40 || chunks.some((chunk) => chunk.content.trim().length === 0)) {
      throw new Error('Rerank one to forty nonblank passages with a nonblank question');
    }
    this.model ??= this.load();
    let model: { tokenizer: Tokenizer; session: InferenceSession };
    try {
      model = await this.model;
    } catch (error) {
      this.model = null;
      throw error;
    }
    const encoded = chunks.map((chunk) => model.tokenizer.encode(question,
      { text_pair: chunk.content, return_token_type_ids: true }));
    // Pair encoding follows the model card; retain every evidence token rather than silently truncate it.
    if (encoded.some((input) => input.ids.length > 512)) {
      throw new Error('Reranker input exceeds the 512-token pair budget');
    }
    const scores: number[] = [];
    for (let start = 0; start < encoded.length; start += 4) {
      const batch = encoded.slice(start, start + 4);
      const width = Math.max(...batch.map((input) => input.ids.length));
      const feeds: Record<string, Tensor> = {};
      for (const field of ['input_ids', 'attention_mask', 'token_type_ids'] as const) {
        const data = new BigInt64Array(batch.length * width);
        for (const [row, input] of batch.entries()) {
          const values = field === 'input_ids' ? input.ids : input[field];
          data.set(BigInt64Array.from(values, BigInt), row * width);
        }
        feeds[field] = new Tensor('int64', data, [batch.length, width]);
      }
      const output = (await model.session.run(feeds)).logits;
      if (!output || !(output.data instanceof Float32Array) || output.dims.length !== 2 ||
          output.dims[0] !== batch.length || output.dims[1] !== 1 || !output.data.every(Number.isFinite)) {
        throw new Error('Reranker returned invalid relevance scores');
      }
      // The model uses identity activation. These raw relevance logits are not probabilities.
      scores.push(...output.data);
    }
    return scores;
  }

  async dispose() {
    const model = this.model;
    this.model = null;
    if (model) await (await model).session.release();
  }

  async onModuleDestroy() {
    await this.dispose();
  }
}
