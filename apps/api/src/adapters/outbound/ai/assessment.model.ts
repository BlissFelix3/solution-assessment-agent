import { Injectable } from '@nestjs/common';
import { instruction, maxOutputTokens, responseSchema, thinkingBudget } from '../../../application/assessment.prompt.js';
import type { AssessmentGenerator, ModelEvent } from '../../../application/ports/assessment-generator.js';
import { ModelClient } from './model.client.js';

@Injectable()
export class AssessmentModel implements AssessmentGenerator {
  private readonly client = new ModelClient();

  async generate(
    question: string,
    sources: readonly { path: string; content: string }[],
    onEvent?: (event: ModelEvent) => Promise<void>,
  ): Promise<unknown> {
    const result = await this.client.complete({
      instruction, input: { question, sources }, schemaName: 'assessment', schema: responseSchema,
      maxOutputTokens, thinkingBudget, budgetMs: 30_000,
    }, onEvent);
    return result.value;
  }
}
