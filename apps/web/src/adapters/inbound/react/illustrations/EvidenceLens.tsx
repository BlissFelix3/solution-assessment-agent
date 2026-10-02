import type { RunTrace } from '../../../../domain/assessment.js';
import { nodeStatus, type NodeId } from '../../../../application/flow.js';

export function EvidenceLens({
  trace,
  questionId,
  onInspect,
}: {
  trace: RunTrace | null;
  questionId: string;
  onInspect: (id: NodeId) => void;
}) {
  return (
    <div className="evidence-lens">
      <svg viewBox="0 0 460 320" aria-hidden="true">
        <defs>
          <linearGradient id="lens-white" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#fff" />
            <stop offset=".5" stopColor="#f1f0ff" />
            <stop offset="1" stopColor="#c7bfe9" />
          </linearGradient>
          <linearGradient id="lens-lime" x1="0" y1="0" x2=".7" y2="1">
            <stop stopColor="#f4ffb3" />
            <stop offset=".5" stopColor="#d9ff6c" />
            <stop offset="1" stopColor="#a6d939" />
          </linearGradient>
          <linearGradient id="lens-edge" x1="0" x2="1">
            <stop stopColor="#746890" />
            <stop offset=".4" stopColor="#e4dcfa" />
            <stop offset="1" stopColor="#a498c9" />
          </linearGradient>
          <linearGradient id="lens-glass" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#faf8ff" stopOpacity=".9" />
            <stop offset="1" stopColor="#b49bf6" stopOpacity=".75" />
          </linearGradient>
          <filter id="lens-shadow" x="-50%" y="-100%" width="200%" height="300%">
            <feGaussianBlur stdDeviation="12" />
          </filter>
        </defs>
        <ellipse cx="252" cy="283" rx="121" ry="17" fill="#51425d" opacity=".16" filter="url(#lens-shadow)" />
        <path className="lens-spine" d="M230 58v204" />
        <g className="lens-plate lens-bottom" data-state={nodeStatus(trace, 'persistence', questionId)}>
          <path d="M103 235v14a127 43 0 0 0 254 0v-14Z" fill="url(#lens-edge)" />
          <ellipse cx="230" cy="235" rx="127" ry="43" fill="url(#lens-white)" stroke="#fff" />
          <ellipse cx="230" cy="235" rx="48" ry="16" fill="#b8aecf" />
          <ellipse cx="230" cy="230" rx="48" ry="16" fill="#efeaf8" />
          <path d="M123 240c18 28 70 42 122 37" fill="none" stroke="#fff" opacity=".7" />
        </g>
        <g className="lens-plate lens-middle" data-state={nodeStatus(trace, 'retrieval', questionId)}>
          <path d="M87 153v20a143 49 0 0 0 286 0v-20Z" fill="#8c70c2" fillOpacity=".55" stroke="#d2baff" />
          <ellipse cx="230" cy="153" rx="143" ry="49" fill="url(#lens-glass)" stroke="#fff" />
          <ellipse cx="230" cy="153" rx="82" ry="28" fill="#e5dfef" fillOpacity=".8" stroke="#ac8cdf" />
          <ellipse cx="230" cy="148" rx="82" ry="28" fill="#f6f3ff" fillOpacity=".6" />
          <path d="M101 148c28-30 108-47 176-29" fill="none" stroke="#fff" strokeWidth="2" />
        </g>
        <g className="lens-plate lens-top" data-state={nodeStatus(trace, 'sources', questionId)}>
          <path d="M118 69v13a112 39 0 0 0 224 0V69Z" fill="#97b942" />
          <ellipse cx="230" cy="69" rx="112" ry="39" fill="url(#lens-lime)" stroke="#efffb6" />
          <ellipse cx="230" cy="69" rx="47" ry="16" fill="#8cae3b" />
          <ellipse cx="230" cy="64" rx="47" ry="16" fill="#e5e0ef" />
          <path d="M133 62c22-25 69-32 97-31" fill="none" stroke="#fff" strokeWidth="2" opacity=".8" />
        </g>
        <path className="lens-guide" d="M339 62h61M373 155h40M357 237h42" />
      </svg>
      <button className="lens-label lens-source" onClick={() => onInspect('sources')}>
        <span>01</span> Sources <span aria-hidden="true">↗</span>
      </button>
      <button className="lens-label lens-retrieval" onClick={() => onInspect('retrieval')}>
        <span>02</span> Retrieval <span aria-hidden="true">↗</span>
      </button>
      <button className="lens-label lens-answer" onClick={() => onInspect('persistence')}>
        <span>03</span> Assessment <span aria-hidden="true">↗</span>
      </button>
      <span className="lens-caption">{trace ? 'Inspect this execution' : 'Explore the architecture'}</span>
    </div>
  );
}
