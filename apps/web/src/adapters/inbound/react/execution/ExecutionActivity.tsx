import type { Execution, SourceSelection } from '../../../../domain/execution.js';
import { elapsed, nodes, nodeStatus, type NodeId } from '../../../../application/flow.js';
import { Status } from '../components/Status.js';

export function ExecutionActivity({
  execution,
  questionId,
  onInspect,
  onSource,
}: {
  execution: Execution | null;
  questionId: string;
  onInspect: (id: NodeId) => void;
  onSource: (source: SourceSelection) => void;
}) {
  const trace = execution?.trace ?? null;
  const events =
    trace?.events.filter((event) => !event.questionId || event.questionId === questionId) ?? [];
  const retrieval = [...events]
    .reverse()
    .find((event) => event.stage === 'retrieval' && event.status === 'succeeded');
  const candidates = retrieval?.data.candidates;
  const generation = [...events]
    .reverse()
    .find((event) => event.stage === 'generation' && event.status === 'started');
  return (
    <div className="execution-activity">
      <div className="activity-heading">
        <strong>Inside the assessment API</strong>
        <span>Retrieved evidence → grounded answer</span>
      </div>
      <div className="rag-stages">
        {nodes
          .filter((node) =>
            ['retrieval', 'generation', 'validation', 'persistence'].includes(node.id),
          )
          .map((node) => {
            const state = nodeStatus(trace, node.id, questionId);
            return (
              <button key={node.id} onClick={() => onInspect(node.id)} data-state={state}>
                <span>
                  {state === 'succeeded'
                    ? '✓'
                    : state === 'started'
                      ? '◌'
                      : state === 'failed'
                        ? '×'
                        : '○'}
                </span>
                <strong>{node.title}</strong>
                <small>{state === 'waiting' ? 'Waiting' : state}</small>
              </button>
            );
          })}
      </div>
      {generation && (
        <p className="model-label">
          Model:{' '}
          {typeof generation.data.provider === 'string' ? `${generation.data.provider} / ` : ''}
          {typeof generation.data.model === 'string' ? generation.data.model : 'See model payload'}
        </p>
      )}
      {Array.isArray(candidates) && (
        <details className="retrieved-documents" open>
          <summary>
            Retrieved {candidates.length} document{candidates.length === 1 ? '' : 's'}{' '}
            <span>Actual model context</span>
          </summary>
          {candidates.map((candidate: unknown, index) => {
            if (
              !candidate ||
              typeof candidate !== 'object' ||
              !('path' in candidate) ||
              typeof candidate.path !== 'string' ||
              !('content' in candidate) ||
              typeof candidate.content !== 'string'
            )
              return null;
            const path = candidate.path;
            return (
              <details key={path} className="retrieved-document">
                <summary>
                  <span>
                    {index + 1}. {path}
                  </span>
                  <span>
                    {'score' in candidate && typeof candidate.score === 'number'
                      ? `Rank ${candidate.score.toFixed(3)}`
                      : 'Retrieved'}
                  </span>
                </summary>
                <pre>{candidate.content}</pre>
                <button onClick={() => onSource({ path, quote: '' })}>
                  Open full pinned source ↗
                </button>
              </details>
            );
          })}
        </details>
      )}
      <details className="execution-log">
        <summary>
          Execution receipts <span>{events.length} events</span>
        </summary>
        {events.length === 0 ? (
          <p>Ask a question to see retrieval, generation and citation checks here.</p>
        ) : (
          events.map((event) => (
            <button key={event.id} onClick={() => onInspect(event.stage)}>
              <span>+{elapsed(trace?.createdAt ?? event.createdAt, event.createdAt)}</span>
              <strong>
                {event.stage}
                {typeof event.data.reason === 'string' ? ` · ${event.data.reason}` : ''}
              </strong>
              <Status value={event.status} />
              <span>↗</span>
            </button>
          ))
        )}
      </details>
      <p className="execution-footnote">
        These are observed API events, not private model thoughts or internal n8n node telemetry.
        Retrieval uses PostgreSQL full-text search.
      </p>
    </div>
  );
}
