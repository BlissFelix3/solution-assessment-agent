import type { RunProgress, RunTrace } from './assessment.js';

export type Execution = {
  mode: 'live' | 'recorded';
  trace: RunTrace;
  progress: RunProgress;
};

export type SourceSelection = { path: string; quote: string };
