export type EmbeddingIdentity = {
  model: string;
  revision: string;
  dimensions: number;
  dtype: 'q8';
};

export type RerankerIdentity = {
  model: string;
  revision: string;
  dtype: 'q8';
};

export type SourceChunk = {
  id: string;
  path: string;
  content: string;
  startOffset: number;
  endOffset: number;
};

export type ContextWindow = SourceChunk & { seedChunkId: string };

export type EvidenceIndexManifest = {
  id: string;
  sourceRevisionId: string;
  embedding: EmbeddingIdentity;
  chunkerVersion: string;
  totalChunks: number;
};

export type RankedChunk = SourceChunk & {
  lexicalRank: number | null;
  semanticRank: number | null;
  lexicalScore: number | null;
  cosineSimilarity: number | null;
  fusionScore: number;
  fusionRank: number;
  rerankScore: number | null;
  rerankRank: number | null;
  selectedRank: number | null;
  selection: 'selected' | 'overlap' | 'document_limit' | 'context_limit' | 'character_budget';
};

export type RetrievalResult = {
  mode: 'hybrid' | 'keyword';
  sourceRevisionId: string;
  indexId: string;
  embedding: EmbeddingIdentity;
  reranker: RerankerIdentity | null;
  rerankDurationMs: number | null;
  queryPlan: {
    queries: string[]; provider: 'groq' | 'cerebras' | 'gemini'; model: string; promptVersion: string;
    startedAt: string; completedAt: string;
    initialEvidence: SourceChunk[];
  } | null;
  searches: {
    query: string; startedAt: string; completedAt: string;
    keyword: ScoredChunk[]; semantic: ScoredChunk[];
  }[];
  reranks: {
    query: string; startedAt: string; completedAt: string;
    scores: { chunkId: string; score: number; rank: number }[];
  }[];
  chunkerVersion: string;
  totalChunks: number;
  candidateLimit: number;
  contextLimit: number;
  contextCharacterLimit: number;
  rrfK: number;
  candidates: RankedChunk[];
  context: ContextWindow[];
};

export const chunkerVersion = 'word-window-600-overlap-100-v1';
export const maxChunkCharacters = 600;
const overlapCharacters = 100;

// Offsets use JavaScript UTF-16 positions so the document reader can select the exact span.
export function chunkDocument(path: string, content: string): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  let start = 0;
  while (start < content.length) {
    while (start < content.length && /\s/u.test(content[start]!)) start += 1;
    if (start === content.length) break;

    let end = Math.min(start + maxChunkCharacters, content.length);
    if (end < content.length) {
      const paragraph = content.lastIndexOf('\n\n', end);
      if (paragraph >= start + maxChunkCharacters / 2) {
        end = paragraph;
      } else {
        let boundary = end;
        while (boundary > start + maxChunkCharacters / 2 && !/\s/u.test(content[boundary]!)) {
          boundary -= 1;
        }
        if (boundary > start + maxChunkCharacters / 2) end = boundary;
      }
      if (/^[\uDC00-\uDFFF]$/u.test(content[end]!)) end -= 1;
    }
    while (end > start && /\s/u.test(content[end - 1]!)) end -= 1;
    chunks.push({
      id: `${path}:${start}:${end}`,
      path,
      content: content.slice(start, end),
      startOffset: start,
      endOffset: end,
    });
    if (end === content.length || content.slice(end).trim().length === 0) break;

    let nextStart = Math.max(start + 1, end - overlapCharacters);
    while (nextStart < end && !/\s/u.test(content[nextStart - 1]!)) nextStart += 1;
    start = nextStart;
  }
  return chunks;
}

export type ScoredChunk = SourceChunk & { score: number };
export const retrievalCandidateLimit = 20;
export const contextLimit = 5;
export const contextCharacterLimit = 6000;
export const rrfK = 60;

export function contextWindow(chunk: SourceChunk, document: string): ContextWindow {
  if (document.slice(chunk.startOffset, chunk.endOffset) !== chunk.content) {
    throw new Error('Context seed does not match its pinned source document');
  }
  let startOffset = Math.max(0, chunk.startOffset - 300);
  let endOffset = Math.min(document.length, chunk.endOffset + 300);
  if (/^[\uDC00-\uDFFF]$/u.test(document[startOffset]!)) startOffset += 1;
  if (/^[\uDC00-\uDFFF]$/u.test(document[endOffset]!)) endOffset -= 1;
  return {
    id: `${chunk.path}:${startOffset}:${endOffset}`, seedChunkId: chunk.id, path: chunk.path,
    content: document.slice(startOffset, endOffset), startOffset, endOffset,
  };
}

function overlap(left: SourceChunk, right: SourceChunk): boolean {
  const shared = Math.max(0, Math.min(left.endOffset, right.endOffset) - Math.max(left.startOffset, right.startOffset));
  return shared / Math.min(left.content.length, right.content.length) > 0.5;
}

export function selectWindows(windows: readonly ContextWindow[], candidates: RankedChunk[]): ContextWindow[] {
  const context: ContextWindow[] = [];
  let size = 0;
  if (windows.length !== candidates.length || windows.some((window, index) => window.seedChunkId !== candidates[index]?.id)) {
    throw new Error('Expanded context must retain the ranked candidate order');
  }
  for (const [index, window] of windows.entries()) {
    const candidate = candidates[index]!;
    candidate.selectedRank = null;
    const samePath = context.filter((selected) => selected.path === window.path);
    if (samePath.some((selected) => overlap(selected, window))) candidate.selection = 'overlap';
    else if (samePath.length >= 2) candidate.selection = 'document_limit';
    else if (context.length >= contextLimit) candidate.selection = 'context_limit';
    else if (size + window.content.length > contextCharacterLimit) candidate.selection = 'character_budget';
    else {
      context.push(window);
      size += window.content.length;
      candidate.selection = 'selected';
      candidate.selectedRank = context.length;
    }
  }
  return context;
}

export function fuseChunks(keyword: readonly ScoredChunk[], semantic: readonly ScoredChunk[]): RankedChunk[] {
  return fuseSearches([{ keyword, semantic }]);
}

export function fuseSearches(searches: readonly { keyword: readonly ScoredChunk[]; semantic: readonly ScoredChunk[] }[]): RankedChunk[] {
  const candidates = new Map<string, RankedChunk>();
  for (const { keyword, semantic } of searches) {
    for (const [kind, chunks] of [['keyword', keyword], ['semantic', semantic]] as const) {
      for (const [index, chunk] of chunks.entries()) {
        const candidate = candidates.get(chunk.id) ?? {
          id: chunk.id, path: chunk.path, content: chunk.content,
          startOffset: chunk.startOffset, endOffset: chunk.endOffset,
          lexicalRank: null, semanticRank: null, lexicalScore: null, cosineSimilarity: null,
          fusionScore: 0, fusionRank: 0, rerankScore: null, rerankRank: null,
          selectedRank: null, selection: 'context_limit' as const,
        };
        if (kind === 'keyword') {
          candidate.lexicalRank = Math.min(candidate.lexicalRank ?? Infinity, index + 1);
          candidate.lexicalScore = Math.max(candidate.lexicalScore ?? -Infinity, chunk.score);
        } else {
          candidate.semanticRank = Math.min(candidate.semanticRank ?? Infinity, index + 1);
          candidate.cosineSimilarity = Math.max(candidate.cosineSimilarity ?? -Infinity, chunk.score);
        }
        candidate.fusionScore += 1 / (rrfK + index + 1);
        candidates.set(chunk.id, candidate);
      }
    }
  }
  const ranked = [...candidates.values()].sort((a, b) =>
    b.fusionScore - a.fusionScore || a.path.localeCompare(b.path) || a.startOffset - b.startOffset);
  for (const [index, candidate] of ranked.entries()) candidate.fusionRank = index + 1;
  if (ranked.length > retrievalCandidateLimit * 2 && searches.length > 1) {
    const perQuery = searches.map((search) => fuseSearches([search]));
    const pooled = new Set<string>();
    for (let position = 0; pooled.size < retrievalCandidateLimit * 2 && position < retrievalCandidateLimit * 2; position += 1) {
      for (const query of perQuery) {
        const chunk = query[position];
        if (chunk) pooled.add(chunk.id);
        if (pooled.size === retrievalCandidateLimit * 2) break;
      }
    }
    return selectContext(ranked.filter((chunk) => pooled.has(chunk.id)));
  }
  return selectContext(ranked.slice(0, retrievalCandidateLimit * 2));
}

export function interleaveReranks(rankings: readonly (readonly RankedChunk[])[]): RankedChunk[] {
  const seen = new Set<string>();
  const interleaved: RankedChunk[] = [];
  const longest = Math.max(0, ...rankings.map((ranking) => ranking.length));
  // Give each subquestion a context slot before any one subquestion can consume the entire budget.
  for (let rank = 0; rank < longest; rank += 1) {
    for (const ranking of rankings) {
      const chunk = ranking[rank];
      if (!chunk || seen.has(chunk.id)) continue;
      seen.add(chunk.id);
      interleaved.push({ ...chunk, selectedRank: null, rerankRank: interleaved.length + 1 });
    }
  }
  return selectContext(interleaved);
}

export function rerankChunks(candidates: readonly RankedChunk[], scores: readonly number[]): RankedChunk[] {
  if (scores.length !== candidates.length || !scores.every(Number.isFinite)) {
    throw new Error('Reranker must return one finite score per candidate');
  }
  const ranked = candidates.map((candidate, index) => ({
    ...candidate, rerankScore: scores[index]!, selectedRank: null,
  })).sort((a, b) => b.rerankScore - a.rerankScore || a.fusionRank - b.fusionRank);
  for (const [index, candidate] of ranked.entries()) candidate.rerankRank = index + 1;
  return selectContext(ranked);
}

function selectContext(ranked: RankedChunk[]): RankedChunk[] {
  const selected: RankedChunk[] = [];
  let contextCharacters = 0;
  for (const candidate of ranked) {
    const sameDocument = selected.filter((chunk) => chunk.path === candidate.path);
    const overlaps = sameDocument.some((chunk) => overlap(chunk, candidate));
    if (overlaps) candidate.selection = 'overlap';
    else if (sameDocument.length >= 2) candidate.selection = 'document_limit';
    else if (selected.length >= contextLimit) candidate.selection = 'context_limit';
    else if (contextCharacters + candidate.content.length > contextCharacterLimit) {
      candidate.selection = 'character_budget';
    } else {
      candidate.selection = 'selected';
      candidate.selectedRank = selected.length + 1;
      selected.push(candidate);
      contextCharacters += candidate.content.length;
    }
  }
  return ranked;
}
