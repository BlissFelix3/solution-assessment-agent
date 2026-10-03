import { Tokenizer } from '@huggingface/tokenizers';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import { readFile } from 'node:fs/promises';
import type { TextEmbedder } from '../../../application/ports/text-embedder.js';
import type { EmbeddingIdentity } from '../../../domain/retrieval.js';
import { modelFile } from './model.files.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class LocalTextEmbedder implements TextEmbedder {
  readonly identity: EmbeddingIdentity = {
    model: 'Xenova/all-MiniLM-L6-v2',
    revision: '751bff37182d3f1213fa05d7196b954e230abad9',
    dimensions: 384,
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
      throw new Error('Embedding model returned invalid tokenizer files');
    }
    return {
      tokenizer: new Tokenizer(tokenizerJson, tokenizerConfig),
      session: await InferenceSession.create(modelPath, { intraOpNumThreads: 2 }),
    };
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length > 4 || texts.some((text) => text.trim().length === 0)) {
      throw new Error('Embed one to four nonblank texts at a time');
    }
    this.model ??= this.load();
    let model: { tokenizer: Tokenizer; session: InferenceSession };
    try {
      model = await this.model;
    } catch (error) {
      this.model = null;
      throw error;
    }
    const encoded = texts.map((text) => model.tokenizer.encode(text, { return_token_type_ids: true }));
    // MiniLM was trained for short passages. Never silently truncate an indexed passage.
    if (encoded.some((input) => input.ids.length > 256)) {
      throw new Error('Embedding input exceeds the MiniLM 256-token budget');
    }
    const width = Math.max(...encoded.map((input) => input.ids.length));
    const feeds: Record<string, Tensor> = {};
    for (const field of ['input_ids', 'attention_mask', 'token_type_ids'] as const) {
      const data = new BigInt64Array(encoded.length * width);
      for (const [row, input] of encoded.entries()) {
        const values = field === 'input_ids' ? input.ids : input[field];
        data.set(BigInt64Array.from(values, BigInt), row * width);
      }
      feeds[field] = new Tensor('int64', data, [encoded.length, width]);
    }
    const output = (await model.session.run(feeds)).last_hidden_state;
    if (!output || !(output.data instanceof Float32Array) || output.dims.length !== 3 ||
        output.dims[0] !== encoded.length || output.dims[1] !== width || output.dims[2] !== this.identity.dimensions) {
      throw new Error('Embedding model returned unexpected dimensions');
    }
    const hiddenState = output.data;
    // Attention-mask mean pooling and L2 normalization follow the MiniLM model card.
    return encoded.map((input, row) => {
      const vector = Array<number>(this.identity.dimensions).fill(0);
      for (let token = 0; token < input.ids.length; token += 1) {
        for (let coordinate = 0; coordinate < vector.length; coordinate += 1) {
          vector[coordinate]! += hiddenState[(row * width + token) * vector.length + coordinate]!;
        }
      }
      const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
      if (!Number.isFinite(norm) || norm === 0) throw new Error('Embedding model returned an invalid vector');
      return vector.map((value) => value / norm);
    });
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
