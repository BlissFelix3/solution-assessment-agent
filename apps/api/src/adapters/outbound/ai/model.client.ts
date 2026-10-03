import type { ModelEvent } from '../../../application/ports/assessment-generator.js';

type ModelRequest = {
  instruction: string; input: unknown; schemaName: string; schema: object;
  maxOutputTokens: number; thinkingBudget: number; budgetMs: number;
};

type Provider = { name: 'groq' | 'cerebras' | 'gemini'; model: string; key: string; url: string };

function configuredProviders(): Provider[] {
  const providers: Provider[] = [];
  if (process.env.GROQ_API_KEY)
    providers.push({
      name: 'groq',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
      key: process.env.GROQ_API_KEY,
      url: 'https://api.groq.com/openai/v1/chat/completions',
    });
  if (process.env.CEREBRAS_API_KEY)
    providers.push({
      name: 'cerebras',
      model: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
      key: process.env.CEREBRAS_API_KEY,
      url: 'https://api.cerebras.ai/v1/chat/completions',
    });
  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    providers.push({
      name: 'gemini',
      model,
      key: process.env.GEMINI_API_KEY,
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    });
  }
  return providers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function completionText(body: unknown, provider: Provider['name'], name: string): string {
  if (!isRecord(body)) throw new Error(`Model returned no ${name}`);
  if (provider === 'gemini') {
    const candidate: unknown = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
    if (
      !isRecord(candidate) ||
      candidate.finishReason !== 'STOP' ||
      !isRecord(candidate.content) ||
      !Array.isArray(candidate.content.parts)
    )
      throw new Error(`Model returned no complete ${name}`);
    const part: unknown = candidate.content.parts.find(
      (item: unknown) => isRecord(item) && item.thought !== true && typeof item.text === 'string',
    );
    if (!isRecord(part) || typeof part.text !== 'string')
      throw new Error(`Model returned no ${name} text`);
    return part.text;
  }
  const choice: unknown = Array.isArray(body.choices) ? body.choices[0] : undefined;
  if (
    !isRecord(choice) ||
    choice.finish_reason !== 'stop' ||
    !isRecord(choice.message) ||
    typeof choice.message.content !== 'string'
  )
    throw new Error(`Model returned no complete ${name}`);
  return choice.message.content;
}

export class ModelClient {
  async complete(
    request: ModelRequest,
    onEvent?: (event: ModelEvent) => Promise<void>,
  ): Promise<{ value: unknown; provider: Provider['name']; model: string }> {
    const providers = configuredProviders();
    if (providers.length === 0)
      throw new Error('Configure GROQ_API_KEY, CEREBRAS_API_KEY or GEMINI_API_KEY on the server');
    const budget = AbortSignal.timeout(request.budgetMs);
    let failure = 'Model providers are unavailable';
    for (const provider of providers) {
      if (budget.aborted) break;
      await onEvent?.({ provider: provider.name, model: provider.model, status: 'started' });
      const input = JSON.stringify(request.input);
      const body =
        provider.name === 'gemini'
          ? {
              systemInstruction: { parts: [{ text: request.instruction }] },
              contents: [{ role: 'user', parts: [{ text: input }] }],
              generationConfig: {
                maxOutputTokens: request.maxOutputTokens,
                thinkingConfig: { thinkingBudget: request.thinkingBudget },
                responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: request.schema } },
              },
            }
          : {
              model: provider.model,
              messages: [
                { role: 'system', content: request.instruction },
                { role: 'user', content: input },
              ],
              max_completion_tokens: request.maxOutputTokens,
              reasoning_effort: 'low',
              response_format: {
                type: 'json_schema',
                json_schema: { name: request.schemaName, strict: true, schema: request.schema },
              },
            };
      const signal = AbortSignal.any([budget, AbortSignal.timeout(15_000)]);
      let response: Response;
      try {
        response = await fetch(provider.url, {
          method: 'POST',
          signal,
          headers:
            provider.name === 'gemini'
              ? { 'Content-Type': 'application/json', 'x-goog-api-key': provider.key }
              : { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
          body: JSON.stringify(body),
        });
      } catch {
        failure = signal.aborted
          ? 'Model request timed out'
          : 'Model provider could not be reached';
        await onEvent?.({
          provider: provider.name,
          model: provider.model,
          status: 'failed',
          reason: failure,
        });
        continue;
      }
      if (!response.ok) {
        failure =
          response.status === 429
            ? 'Model provider rate limit reached'
            : `Model request failed (${response.status})`;
        await onEvent?.({
          provider: provider.name,
          model: provider.model,
          status: 'failed',
          reason: failure,
        });
        if (response.status === 429 || response.status >= 500) continue;
        throw new Error(failure);
      }
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        if (signal.aborted) {
          failure = 'Model request timed out';
          await onEvent?.({
            provider: provider.name,
            model: provider.model,
            status: 'failed',
            reason: failure,
          });
          continue;
        }
        throw new Error('Model returned invalid JSON');
      }
      const content = completionText(result, provider.name, request.schemaName);
      try {
        const draft: unknown = JSON.parse(content);
        return { value: draft, provider: provider.name, model: provider.model };
      } catch {
        throw new Error(`Model returned invalid ${request.schemaName} JSON`);
      }
    }
    throw new Error(failure);
  }
}
