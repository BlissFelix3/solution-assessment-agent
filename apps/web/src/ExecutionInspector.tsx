import { useEffect, useRef, useState } from 'react';
import {
  getSource,
  type Assessment,
  type RunProgress,
  type RunTrace,
  type SourceDocument,
  type TraceEvent,
} from './api.js';
import { elapsed, eventsFor, nodes, repositoryUrl, requirements, type NodeId } from './flow.js';
import { Status } from './Status.js';

export type Execution = { mode: 'live' | 'recorded'; trace: RunTrace; progress: RunProgress };
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
        return { path, content: candidate.content, sourceRevisionId: trace.sourceRevisionId };
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
  }, [execution.mode, execution.trace.runId, selection.path]);
  const index = selection.quote && document ? document.content.indexOf(selection.quote) : -1;
  return (
    <dialog className="source-dialog" ref={ref} onClose={onClose} aria-labelledby="source-title">
      <header>
        <div>
          <span className="overline">Immutable evidence</span>
          <h2 id="source-title">{selection.path}</h2>
        </div>
        <button className="icon-button" onClick={() => ref.current?.close()} aria-label="Close source">
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
          <p className="revision">{document.sourceRevisionId}</p>
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
  const candidates = event?.data.candidates;
  if (!Array.isArray(candidates)) return null;
  return (
    <div className="retrieval-list">
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
          typeof candidate.score !== 'number'
        )
          return null;
        const { path, content, score } = candidate;
        return (
          <button className="retrieval-document" key={path} onClick={() => onSource({ path, quote: '' })}>
            <span className="document-rank">{String(index + 1).padStart(2, '0')}</span>
            <span>
              <strong>{path}</strong>
              <span className="document-excerpt">{content.slice(0, 150)}</span>
              <span className="rank-track">
                <i style={{ width: `${Math.min(100, score * 100)}%` }} />
              </span>
            </span>
            <code>{score.toFixed(3)}</code>
          </button>
        );
      })}
      <p className="fine-print">Scores are PostgreSQL relevance ranks, not confidence probabilities.</p>
    </div>
  );
}

export function Inspector({
  selected,
  questionId,
  execution,
  onSource,
}: {
  selected: NodeId;
  questionId: string;
  execution: Execution | null;
  onSource: (source: SourceSelection) => void;
}) {
  const [tab, setTab] = useState<'evidence' | 'payload' | 'code'>('evidence');
  const node = nodes.find((item) => item.id === selected);
  const events = eventsFor(execution?.trace ?? null, selected, questionId);
  const assessment = execution?.progress.assessments.find((item) => item.questionId === questionId);
  if (!node) throw new Error('Unknown pipeline step');
  return (
    <aside className="inspector" aria-label="Step inspector">
      <div className="inspector-heading">
        <span className="overline">Step inspector</span>
        <span className="step-index">{node.number} / SYSTEM</span>
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
          <h2>{node.title}</h2>
        </div>
      </div>
      <p className="inspector-description">{node.description}</p>
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
              Follow the real implementation, SQL constraints, model prompt, and exported n8n workflow in the
              public repository.
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
                <JsonView
                  value={{ attemptId: event.attemptId, questionId: event.questionId, ...event.data }}
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
                <ol className="workflow-list">
                  {[
                    'Create a run & return HTTP 202',
                    'Prepare three requirement items',
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
                  An admitted start counts even if its response is lost. This keeps uncertain outcomes inside
                  the cost limit.
                </p>
              </>
            )}
            {selected === 'sources' && (
              <>
                <div className="execution-identity">
                  <span className="overline">Pinned source revision</span>
                  <code>{execution?.trace.sourceRevisionId ?? 'Selected when the run is created'}</code>
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
            {(selected === 'generation' || selected === 'validation' || selected === 'persistence') &&
              assessment && (
                <>
                  <div className="section-label">
                    <span>Saved assessment</span>
                    <span>Requirement {requirements.findIndex((r) => r.id === questionId) + 1}</span>
                  </div>
                  <AssessmentResult assessment={assessment} onSource={onSource} />
                </>
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
    </aside>
  );
}
