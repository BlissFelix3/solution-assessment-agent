import { useState } from 'react';
import definition from '../../../../../../../n8n/complete-assessment.json';
import { n8nNodeStatus, type NodeId, repositoryUrl } from '../../../../application/flow.js';
import type { RunTrace } from '../../../outbound/http/api.js';

const main = definition.nodes.filter(
  (node) =>
    !['Start locally', 'Run failed', 'Identify failed execution', 'Mark failed'].includes(
      node.name,
    ),
);
const positions = new Map(
  main.map((node, index) => {
    const row = Math.floor(index / 4);
    const column = row % 2 === 0 ? index % 4 : 3 - (index % 4);
    return [node.name, { x: 25 + column * 160, y: 30 + row * 115 }];
  }),
);
positions.set('Start locally', { x: 25, y: 375 });
['Run failed', 'Identify failed execution', 'Mark failed'].forEach((name, index) =>
  positions.set(name, { x: 185 + index * 160, y: 375 }),
);

export function BackendFlow({
  onSelect,
  trace,
  questionId,
}: {
  onSelect: (id: NodeId) => void;
  trace: RunTrace | null;
  questionId: string;
}) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected = definition.nodes.find((node) => node.name === selectedName);
  return (
    <div className="workflow-card">
      <header>
        <span className="n8n-mark">⌘</span>
        <strong>Assessment workflow</strong>
        <span className="workflow-badge">n8n</span>
        <a
          href={`${repositoryUrl}/blob/main/n8n/complete-assessment.json`}
          target="_blank"
          rel="noreferrer"
        >
          Open definition ↗
        </a>
      </header>
      <div
        className="workflow-scroll"
        tabIndex={0}
        aria-label="n8n workflow diagram; scroll horizontally on small screens"
      >
        <div className="workflow-graph">
          <svg viewBox="0 0 670 485" aria-hidden="true">
            <defs>
              <marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6" fill="#7c879b" />
              </marker>
            </defs>
            {Object.entries(definition.connections).flatMap(([from, connection]) =>
              connection.main.flatMap((outputs) =>
                outputs.map(({ node: to }) => {
                  const a = positions.get(from),
                    b = positions.get(to);
                  if (!a || !b) return null;
                  const down = b.y > a.y;
                  const right = b.x > a.x;
                  const x1 = down ? a.x + 70 : a.x + (right ? 140 : 0);
                  const y1 = down ? a.y + 72 : a.y + 36;
                  const x2 = down ? b.x + 70 : b.x + (right ? 0 : 140);
                  const y2 = down ? b.y : b.y + 36;
                  return (
                    <path
                      key={`${from}-${to}`}
                      d={
                        from === 'Start locally'
                          ? `M${a.x},${a.y + 36} H8 V12 H${b.x + 70} V${b.y}`
                          : `M${x1},${y1} L${x2},${y2}`
                      }
                      markerEnd="url(#arrow)"
                    />
                  );
                }),
              ),
            )}
          </svg>
          {definition.nodes.map((node) => {
            const position = positions.get(node.name);
            if (!position) return null;
            const kind = node.type.split('.').at(-1) ?? '';
            const state = n8nNodeStatus(trace, node.name, questionId);
            return (
              <button
                key={node.id}
                className="workflow-node"
                data-state={state}
                style={{ left: position.x, top: position.y }}
                aria-pressed={selectedName === node.name}
                onClick={() => setSelectedName(selectedName === node.name ? null : node.name)}
              >
                {state && (
                  <span className="node-receipt" aria-label={`API receipt: ${state}`}>
                    {state === 'succeeded'
                      ? '✓'
                      : state === 'failed'
                        ? '×'
                        : state === 'unconfirmed'
                          ? '?'
                          : '◌'}
                  </span>
                )}
                <span className="workflow-icon" data-kind={kind}>
                  {kind === 'code'
                    ? '{ }'
                    : kind.includes('Trigger')
                      ? 'ϟ'
                      : kind === 'webhook'
                        ? '↪'
                        : '↔'}
                </span>
                <span>
                  <strong>{node.name}</strong>
                  <small>{kind.replace(/([A-Z])/g, ' $1')}</small>
                </span>
              </button>
            );
          })}
          <span className="workflow-caption">Main path · local trigger · failure path</span>
        </div>
      </div>
      {selected && (
        <div className="workflow-node-detail">
          <div>
            <strong>{selected.name}</strong>
            <button aria-label="Close node definition" onClick={() => setSelectedName(null)}>
              ×
            </button>
          </div>
          <p>Exported node definition · {selected.type.split('.').at(-1)}</p>
          <pre>{JSON.stringify(selected.parameters, null, 2)}</pre>
          {selected.name === 'Assess requirement' && (
            <button className="node-api-link" onClick={() => onSelect('retrieval')}>
              Inspect this call’s retrieval and model context ↗
            </button>
          )}
        </div>
      )}
      <footer>
        Exported n8n workflow · badges mark observed API receipts for the selected question.
        Select any node to inspect its configuration.
      </footer>
    </div>
  );
}
