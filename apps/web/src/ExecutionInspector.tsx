import { useEffect, useRef, useState } from 'react';
import {
  getSource,
  type Assessment,
  type RunProgress,
  type RunTrace,
  type SourceDocument,
  type TraceEvent,
} from './api.js';
import { elapsed, eventsFor, nodes, nodeStatus, repositoryUrl, type NodeId } from './flow.js';
import { Status } from './Status.js';
import './inspector.css';

export type Execution = {
  mode: 'live' | 'recorded';
  trace: RunTrace;
  progress: RunProgress;
};
export type SourceSelection = { path: string; quote: string };

function JsonView({ value }: { value: unknown }) {
  return <pre className="json-view">{JSON.stringify(value, null, 2)}</pre>;
}

function AssessmentResult({
  assessment,
  onSource,
}: {
  assessment: Assessment;
  onSource: (source: SourceSelection) => void;
}) {
  return (
    <div className="assessment-result">
      <Status value={assessment.verdict} />
      <p>{assessment.explanation}</p>
      {assessment.basis.map((source, index) => (
        <blockquote key={`${source.path}-${index}`}>
          <p>“{source.quote}”</p>
          <button className="text-button" onClick={() => onSource(source)}>
            {source.path} ↗
          </button>
        </blockquote>
      ))}
      {assessment.notProof.map((source, index) => (
        <blockquote className="insufficient" key={`${source.path}-${index}`}>
          <span className="overline">Relevant, but insufficient</span>
          <p>“{source.quote}”</p>
          <p className="muted">{source.reason}</p>
          <button className="text-button" onClick={() => onSource(source)}>
            {source.path} ↗
          </button>
        </blockquote>
      ))}
      {assessment.missingEvidence && (
        <div className="missing">
          <span className="overline">Evidence still needed</span>
          <p>{assessment.missingEvidence}</p>
        </div>
      )}
    </div>
  );
}

function recordedSource(trace: RunTrace, path: string): SourceDocument | null {
  for (const event of trace.events) {
    const candidates = event.data.candidates;
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      if (
        candidate &&
        typeof candidate === 'object' &&
        'path' in candidate &&
        candidate.path === path &&
        'content' in candidate &&
        typeof candidate.content === 'string'
      ) {
        return {
          path,
          content: candidate.content,
          sourceRevisionId: trace.sourceRevisionId,
        };
      }
    }
  }
  return null;
}

export function SourceDialog({
  execution,
  selection,
  onClose,
}: {
  execution: Execution;
  selection: SourceSelection;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [document, setDocument] = useState<SourceDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setDocument(null);
    setError(null);
    if (execution.mode === 'recorded') {
      const source = recordedSource(execution.trace, selection.path);
      setDocument(source);
      if (!source) setError('This document is not included in the recorded context.');
    } else {
      void getSource(execution.trace.runId, selection.path, controller.signal)
        .then((source) => {
          if (!controller.signal.aborted) {
            if (source.sourceRevisionId !== execution.trace.sourceRevisionId) {
              setError('The document does not belong to this execution revision.');
            } else {
              setDocument(source);
            }
          }
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : 'Source unavailable.');
        });
    }
    return () => controller.abort();
  }, [execution.mode, execution.trace.runId, execution.trace.sourceRevisionId, selection.path]);
  const index = selection.quote && document ? document.content.indexOf(selection.quote) : -1;
  return (
    <dialog
      className="source-dialog evidence-source"
      ref={ref}
      onClose={onClose}
      aria-labelledby="source-title"
    >
      <header>
        <div>
          <span className="overline">Pinned source · read only</span>
          <h2 id="source-title">{selection.path}</h2>
        </div>
        <button
          className="icon-button"
          onClick={() => ref.current?.close()}
          aria-label="Close source"
        >
          ×
        </button>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!document && !error && <p role="status">Loading pinned source…</p>}
      {document && (
        <>
          {selection.quote && index < 0 && (
            <p className="error" role="alert">
              The cited quote is absent from this source revision.
            </p>
          )}
          <div className="source-revision">
            <span className="overline">Source revision</span>
            <p className="revision">{document.sourceRevisionId}</p>
          </div>
          <pre className="source-content">
            {index < 0 ? (
              document.content
            ) : (
              <>
                {document.content.slice(0, index)}
                <mark>{selection.quote}</mark>
                {document.content.slice(index + selection.quote.length)}
              </>
            )}
          </pre>
        </>
      )}
    </dialog>
  );
}

function RetrievalEvidence({
  events,
  onSource,
}: {
  events: TraceEvent[];
  onSource: (source: SourceSelection) => void;
}) {
  const event = [...events].reverse().find((item) => item.status === 'succeeded');
  const request = events.find(
    (item) => item.status === 'started' && item.attemptId === event?.attemptId,
  );
  const candidates = event?.data.candidates;
  if (!Array.isArray(candidates)) return null;
  const highestScore = candidates.reduce((highest: number, candidate: unknown) => {
    if (
      candidate &&
      typeof candidate === 'object' &&
      'score' in candidate &&
      typeof candidate.score === 'number' &&
      Number.isFinite(candidate.score)
    ) {
      return Math.max(highest, candidate.score);
    }
    return highest;
  }, 0);
  return (
    <div className="retrieval-list">
      {typeof request?.data.question === 'string' && (
        <div className="inspector-question">
          <span className="overline">Retrieval input</span>
          <p>{request.data.question}</p>
          <code>English lexemes → OR query → ts_rank_cd</code>
        </div>
      )}
      <div className="section-label">
        <span>Retrieved context</span>
        <span>{candidates.length} documents</span>
      </div>
      {candidates.map((candidate: unknown, index) => {
        if (
          !candidate ||
          typeof candidate !== 'object' ||
          !('path' in candidate) ||
          typeof candidate.path !== 'string' ||
          !('content' in candidate) ||
          typeof candidate.content !== 'string' ||
          !('score' in candidate) ||
          typeof candidate.score !== 'number' ||
          !Number.isFinite(candidate.score)
        )
          return null;
        const { path, content, score } = candidate;
        return (
          <button
            className="retrieval-document"
            key={path}
            onClick={() => onSource({ path, quote: '' })}
          >
            <span className="document-rank">{String(index + 1).padStart(2, '0')}</span>
            <span>
              <strong>{path}</strong>
              <span className="document-excerpt">{content.slice(0, 150)}</span>
              <span className="rank-track">
                <i
                  style={{
                    width: `${highestScore > 0 ? Math.max(0, score / highestScore) * 100 : 0}%`,
                  }}
                />
              </span>
            </span>
            <code>{score.toFixed(3)}</code>
          </button>
        );
      })}
      <p className="fine-print">
        PostgreSQL relevance rank. Bars are relative to the highest score in this result; they do
        not express confidence.
      </p>
    </div>
  );
}

function ModelEvidence({ events }: { events: TraceEvent[] }) {
  const request = [...events].reverse().find((event) => event.status === 'started');
  if (!request) return null;
  const response = events.find(
    (event) => event.status === 'succeeded' && event.attemptId === request.attemptId,
  );
  return (
    <div className="model-evidence">
      <div className="model-receipt">
        <span className="overline">Recorded model call</span>
        {typeof request.data.model === 'string' && (
          <strong>
            {typeof request.data.provider === 'string' ? `${request.data.provider} / ` : ''}
            {request.data.model}
          </strong>
        )}
        <dl>
          {Array.isArray(request.data.sources) && (
            <div>
              <dt>Context</dt>
              <dd>{request.data.sources.length} documents</dd>
            </div>
          )}
          {typeof request.data.maxOutputTokens === 'number' && (
            <div>
              <dt>Output limit</dt>
              <dd>{request.data.maxOutputTokens.toLocaleString()} tokens</dd>
            </div>
          )}
          {typeof request.data.thinkingBudget === 'number' && (
            <div>
              <dt>Thinking budget</dt>
              <dd>{request.data.thinkingBudget.toLocaleString()} tokens</dd>
            </div>
          )}
        </dl>
      </div>
      {typeof request.data.question === 'string' && (
        <div className="inspector-question">
          <span className="overline">Question</span>
          <p>{request.data.question}</p>
        </div>
      )}
      {typeof request.data.instruction === 'string' && (
        <details className="inspector-disclosure">
          <summary>
            System instruction <span>Read prompt ↗</span>
          </summary>
          <p>{request.data.instruction}</p>
        </details>
      )}
      {request.data.responseSchema !== undefined && (
        <details className="inspector-disclosure">
          <summary>
            Structured response schema <span>JSON ↗</span>
          </summary>
          <JsonView value={request.data.responseSchema} />
        </details>
      )}
      {response?.data.draft !== undefined && (
        <details className="inspector-disclosure">
          <summary>
            Model draft <span>Before validation ↗</span>
          </summary>
          <JsonView value={response.data.draft} />
        </details>
      )}
    </div>
  );
}

export function Inspector({
  selected,
  questionId,
  execution,
  onSource,
  onClose,
}: {
  selected: NodeId;
  questionId: string;
  execution: Execution | null;
  onSource: (source: SourceSelection) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'evidence' | 'payload' | 'code'>('evidence');
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const node = nodes.find((item) => item.id === selected);
  const events = eventsFor(execution?.trace ?? null, selected, questionId);
  const attemptIds = [
    ...new Set(events.flatMap((event) => (event.attemptId ? [event.attemptId] : []))),
  ];
  const assessment = execution?.progress.assessments.find((item) => item.questionId === questionId);
  if (!node) throw new Error('Unknown pipeline step');
  return (
    <dialog
      className="inspector inspector-sheet evidence-inspector"
      ref={ref}
      aria-labelledby="inspector-title"
      onClose={onClose}
    >
      <div className="inspector-heading">
        <span className="step-index">{node.number} / UNDER THE HOOD</span>
        <Status value={nodeStatus(execution?.trace ?? null, selected, questionId)} />
        <button
          className="inspector-close"
          aria-label="Close step inspector"
          onClick={() => ref.current?.close()}
        >
          ×
        </button>
      </div>
      <div className="inspector-title">
        <span className={`node-icon ${node.id}`}>
          {node.id === 'sources' || node.id === 'persistence'
            ? '▤'
            : node.id === 'generation'
              ? '✳'
              : node.id === 'workflow'
                ? '⌘'
                : '⌁'}
        </span>
        <div>
          <span className="overline">{node.technology}</span>
          <h2 id="inspector-title">{node.title}</h2>
        </div>
      </div>
      <p className="inspector-description">{node.description}</p>
      <div className="inspector-provenance">
        <span>
          {execution
            ? execution.mode === 'live'
              ? 'Live run evidence'
              : 'Recorded run evidence'
            : 'Architecture'}
        </span>
        <span>
          {events.length} events
          {attemptIds.length > 0
            ? ` · ${attemptIds.length} ${attemptIds.length === 1 ? 'attempt' : 'attempts'}`
            : ''}
        </span>
      </div>
      <div className="inspector-tabs" role="group" aria-label="Step detail">
        {(['evidence', 'payload', 'code'] as const).map((name) => (
          <button
            key={name}
            aria-pressed={tab === name}
            aria-controls="inspector-content"
            id={`tab-${name}`}
            onClick={() => setTab(name)}
          >
            {name === 'evidence' ? 'Inspect' : name === 'payload' ? 'Payloads' : 'Source code'}
          </button>
        ))}
      </div>
      <div
        className="inspector-content"
        id="inspector-content"
        role="region"
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'code' ? (
          <>
            <div className="code-file">
              <span className="overline">Implementation</span>
              <code>{node.file}</code>
              <a href={`${repositoryUrl}/blob/main/${node.file}`} target="_blank" rel="noreferrer">
                Open on GitHub ↗
              </a>
            </div>
            <p className="fine-print">
              Follow the real implementation, SQL constraints, model prompt, and exported n8n
              workflow in the public repository.
            </p>
          </>
        ) : tab === 'payload' ? (
          events.length ? (
            events.map((event) => (
              <details className="event-payload" key={event.id} open={events.length < 4}>
                <summary>
                  <Status value={event.status} />
                  <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
                </summary>
                {event.attemptId && (
                  <p className="payload-attempt">
                    Attempt {attemptIds.indexOf(event.attemptId) + 1} <code>{event.attemptId}</code>
                  </p>
                )}
                <JsonView
                  value={{
                    eventId: event.id,
                    attemptId: event.attemptId,
                    questionId: event.questionId,
                    createdAt: event.createdAt,
                    data: event.data,
                  }}
                />
              </details>
            ))
          ) : (
            <div className="empty-evidence">
              <span>∅</span>
              <h3>No recorded payload yet</h3>
              <p>Run the workflow or open the recorded example to inspect this boundary.</p>
            </div>
          )
        ) : (
          <>
            {selected === 'workflow' && (
              <>
                <div className="execution-identity">
                  <span className="overline">n8n execution</span>
                  <strong>
                    {execution
                      ? execution.trace.executionId
                        ? `#${execution.trace.executionId}`
                        : 'Legacy run'
                      : 'Awaiting execution'}
                  </strong>
                  <span>
                    {execution
                      ? `${execution.trace.events.length} recorded API events`
                      : 'The workflow coordinates every assessment.'}
                  </span>
                </div>
                {execution && (
                  <details className="event-payload">
                    <summary>
                      Submitted requirements · {execution.trace.requirements.length}
                    </summary>
                    <JsonView value={execution.trace.requirements} />
                  </details>
                )}
                <ol className="workflow-list">
                  {[
                    'Create a run & return HTTP 202',
                    'Prepare the submitted requirement items',
                    'Assess each · one retry on failure',
                    'Check responses & read saved results',
                    'Create dossier & complete run',
                  ].map((step, i) => (
                    <li key={step}>
                      <span>{i + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>
                <a
                  className="inline-link"
                  href={`${repositoryUrl}/blob/main/n8n/complete-assessment.json`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Inspect the n8n workflow ↗
                </a>
              </>
            )}
            {selected === 'webhook' && (
              <>
                <div className="http-line">
                  <b>POST</b>
                  <code>/runs/demo</code>
                </div>
                <div className="http-route">
                  <span>Browser</span>
                  <span>→</span>
                  <span>API</span>
                  <span>→</span>
                  <span>n8n</span>
                </div>
                {events
                  .filter((event) => event.status === 'succeeded')
                  .map((event) => (
                    <dl className="webhook-receipt" key={event.id}>
                      {typeof event.data.path === 'string' && (
                        <div>
                          <dt>n8n webhook</dt>
                          <dd>
                            <code>{event.data.path}</code>
                          </dd>
                        </div>
                      )}
                      {typeof event.data.responseStatus === 'number' && (
                        <div>
                          <dt>Response</dt>
                          <dd>HTTP {event.data.responseStatus}</dd>
                        </div>
                      )}
                      {typeof event.data.authentication === 'string' && (
                        <div>
                          <dt>Authentication</dt>
                          <dd>{event.data.authentication}</dd>
                        </div>
                      )}
                    </dl>
                  ))}
                <div className="rule-list">
                  <p>
                    <span>01</span> Reserve hourly demo allowance
                  </p>
                  <p>
                    <span>02</span> Send server-side authentication header
                  </p>
                  <p>
                    <span>03</span> Receive 202 + run identity
                  </p>
                </div>
                <p className="fine-print">
                  An admitted start counts even if its response is lost. This keeps uncertain
                  outcomes inside the cost limit.
                </p>
              </>
            )}
            {selected === 'sources' && (
              <>
                <div className="execution-identity">
                  <span className="overline">Pinned source revision</span>
                  <code>
                    {execution?.trace.sourceRevisionId ?? 'Selected when the run is created'}
                  </code>
                </div>
                <div className="rule-list">
                  <p>
                    <span>01</span> One revision per run
                  </p>
                  <p>
                    <span>02</span> Source documents reject mutation
                  </p>
                  <p>
                    <span>03</span> Citations resolve against this revision
                  </p>
                </div>
              </>
            )}
            {selected === 'retrieval' && <RetrievalEvidence events={events} onSource={onSource} />}
            {selected === 'generation' && (
              <>
                <ModelEvidence events={events} />
                <div className="model-contract">
                  <span className="overline">Response contract</span>
                  <div>
                    <Status value="supported" />
                    <Status value="unsupported" />
                    <Status value="unknown" />
                  </div>
                  <p>The model must distinguish missing evidence from explicit rejection.</p>
                  <code>question + retrieved sources → assessment JSON</code>
                </div>
              </>
            )}
            {selected === 'validation' && (
              <div className="rule-list">
                <p>
                  <span>01</span> Required fields and verdict are valid
                </p>
                <p>
                  <span>02</span> Every citation names a retrieved source
                </p>
                <p>
                  <span>03</span> Every quote occurs exactly in that source
                </p>
                <p>
                  <span>04</span> Unknown identifies the missing evidence
                </p>
              </div>
            )}
            {(selected === 'generation' ||
              selected === 'validation' ||
              selected === 'persistence') &&
              assessment && (
                <>
                  <div className="section-label">
                    <span>Saved assessment</span>
                    <span>
                      {execution?.trace.requirements.find((r) => r.id === questionId)?.label}
                    </span>
                  </div>
                  <AssessmentResult assessment={assessment} onSource={onSource} />
                </>
              )}
            {selected === 'persistence' && (
              <div className="persistence-contract">
                <span className="overline">Write invariant</span>
                <code>PRIMARY KEY (run_id, question_id)</code>
                <p>
                  A retry returns the saved assessment when it already exists. The assessment and
                  success event commit together.
                </p>
                {events.some((event) => event.data.reused === true) && (
                  <span className="reused-assessment">Saved assessment reused in this trace</span>
                )}
              </div>
            )}
            {(selected === 'dossier' || selected === 'completion') &&
              execution?.progress.implementationPath && (
                <div className="dossier-list">
                  {execution.progress.implementationPath.map((step, i) => (
                    <article key={step.questionId}>
                      <span className="overline">
                        0{i + 1} / {step.readiness.replaceAll('_', ' ')}
                      </span>
                      <p>{step.action}</p>
                    </article>
                  ))}
                </div>
              )}
            {execution && events.length > 0 && (
              <div className="step-receipts">
                <div className="section-label">
                  <span>Recorded at this step</span>
                  <span>{events.length}</span>
                </div>
                {events.map((event) => (
                  <div key={event.id}>
                    <Status value={event.status} />
                    {event.attemptId && (
                      <small>Attempt {attemptIds.indexOf(event.attemptId) + 1}</small>
                    )}
                    <span>+{elapsed(execution.trace.createdAt, event.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
            {!events.length &&
              selected !== 'workflow' &&
              selected !== 'webhook' &&
              selected !== 'sources' && (
                <p className="awaiting">No execution evidence recorded for this step yet.</p>
              )}
          </>
        )}
      </div>
      <footer className="inspector-footer">
        <span>Evidence stays attached to its run.</span>
        <kbd>esc</kbd>
      </footer>
    </dialog>
  );
}
