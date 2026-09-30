import type { NodeId } from './flow.js';

const annotations: { id: NodeId; label: string; detail: string; stages: NodeId[] }[] = [
  {
    id: 'sources',
    label: 'Versioned sources',
    detail: 'Pinned document revision',
    stages: ['sources'],
  },
  {
    id: 'workflow',
    label: 'n8n orchestration',
    detail: 'Webhook → n8n → API',
    stages: ['webhook', 'workflow'],
  },
  {
    id: 'retrieval',
    label: 'The RAG pipeline',
    detail: 'Retrieve → generate → validate',
    stages: ['retrieval', 'generation', 'validation'],
  },
  {
    id: 'dossier',
    label: 'Verified dossier',
    detail: 'Persist → dossier → complete',
    stages: ['persistence', 'dossier', 'completion'],
  },
];

const routes: { stages: NodeId[]; path: string }[] = [
  { stages: ['webhook', 'workflow'], path: 'M170 455 C290 420 335 405 400 385' },
  { stages: ['retrieval'], path: 'M260 126 C350 135 350 170 390 215' },
  { stages: ['generation', 'validation'], path: 'M455 245 L620 320 L620 435 L455 360 Z' },
  { stages: ['persistence', 'dossier', 'completion'], path: 'M720 355 C780 370 785 410 820 465' },
];

export function BackendFlow({
  active,
  onSelect,
}: {
  active: NodeId | null;
  onSelect: (id: NodeId) => void;
}) {
  return (
    <div className="machine-scene" data-active={active ?? 'idle'}>
      <div className="scene-orbit" aria-hidden="true" />
      <span className="scene-word" aria-hidden="true">
        EVIDENCE
      </span>
      <div className="machine-object">
        <img
          className="machine-art"
          src="/backend-machine.png"
          width="1536"
          height="1024"
          alt="Sculptural backend illustration: source documents connect to a lime glass processing chamber, a lavender workflow module, and a stack of outputs."
          fetchPriority="high"
        />
        <svg className="scene-signals" viewBox="0 0 1000 667" aria-hidden="true">
          {routes.map(({ stages, path }) => (
            <g key={path} data-active={active !== null && stages.includes(active)}>
              <path className="signal-route" d={path} />
              <circle className="signal-packet" r="5">
                <animateMotion dur="1.6s" repeatCount="indefinite" path={path} />
              </circle>
            </g>
          ))}
        </svg>
      </div>
      {annotations.map((annotation) => {
        const running = active !== null && annotation.stages.includes(active);
        return (
          <button
            key={annotation.id}
            className={`scene-annotation annotation-${annotation.id}`}
            data-active={running}
            onClick={() => onSelect(running && active ? active : annotation.id)}
          >
            <span className="annotation-pin" aria-hidden="true">
              {running ? '↗' : '+'}
            </span>
            <span>
              <strong>{annotation.label}</strong>
              <small>{annotation.detail}</small>
            </span>
          </button>
        );
      })}
      <span className="scene-caption">
        A visual model of the system. Select a part to see its evidence.
      </span>
    </div>
  );
}
