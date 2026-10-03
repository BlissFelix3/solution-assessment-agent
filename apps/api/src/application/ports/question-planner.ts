export type QuestionPlan = {
  queries: string[];
  provider: 'groq' | 'cerebras' | 'gemini';
  model: string;
  promptVersion: string;
};

export interface QuestionPlanner {
  plan(question: string, initialEvidence: readonly SourceChunk[]): Promise<QuestionPlan>;
}
import type { SourceChunk } from '../../domain/retrieval.js';
