export type ModelEvent = {
  provider: 'groq' | 'cerebras' | 'gemini';
  model: string;
} & ({ status: 'started' } | { status: 'failed'; reason: string });

export interface AssessmentGenerator {
  generate(
    question: string,
    sources: readonly { path: string; content: string }[],
    onEvent?: (event: ModelEvent) => Promise<void>,
  ): Promise<unknown>;
}
