import { useEffect, useRef, useState } from 'react';
import { getRunProgress, getRunTrace, getRecordedExecution, startDemo } from './api.js';
import { Inspector, SourceDialog, type Execution, type SourceSelection } from './ExecutionInspector.js';
import { elapsed, eventsFor, nodes, nodeStatus, repositoryUrl, requirements, type NodeId } from './flow.js';
import { Status } from './Status.js';

function initialRunId(): string | null {
  const id = new URLSearchParams(window.location.search).get('run');
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export function App() {
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [selected, setSelected] = useState<NodeId>('workflow');
  const [selectedQuestion, setSelectedQuestion] = useState(requirements[0]);
  const questionId = selectedQuestion.id;
  const [starting, setStarting] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [source, setSource] = useState<SourceSelection | null>(null);
  const exampleAbort = useRef<AbortController | null>(null);
  const navigation = useRef(0);
  const trace = execution?.trace ?? null;
  const pending = execution?.mode === 'live' && trace?.status === 'pending';
  const busy = starting || loadingExample || (runId !== null && (!execution || pending));
  const exampleBusy = starting || loadingExample || (busy && error === null);

  useEffect(() => {
    const onPop = () => {
      navigation.current += 1;
      exampleAbort.current?.abort();
      setLoadingExample(false);
      setStarting(false);
      setSource(null);
      setRunId(initialRunId());
      setExecution(null);
      setError(null);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      exampleAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!runId) return;
    const id = runId;
    const controller = new AbortController();
    let timer: number | undefined;
    async function read() {
      try {
        const [trace, progress] = await Promise.all([
          getRunTrace(id, controller.signal),
          getRunProgress(id, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setExecution({ mode: 'live', trace, progress });
        setError(null);
        if (trace.status === 'pending' || progress.status === 'pending')
          timer = window.setTimeout(() => void read(), 1200);
      } catch (reason: unknown) {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Could not read the execution.');
      }
    }
    void read();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [runId, refresh]);

  async function start() {
    if (busy) return;
    exampleAbort.current?.abort();
    const currentNavigation = navigation.current;
    setStarting(true);
    setError(null);
    setSource(null);
    try {
      const id = await startDemo();
      if (currentNavigation !== navigation.current) return;
      setExecution(null);
      setRunId(id);
      window.history.pushState({}, '', `?run=${encodeURIComponent(id)}`);
    } catch (reason: unknown) {
      if (currentNavigation === navigation.current) {
        setError(reason instanceof Error ? reason.message : 'Could not start execution.');
      }
    } finally {
      if (currentNavigation === navigation.current) setStarting(false);
    }
  }

  async function loadExample() {
    if (exampleBusy) return;
    setRunId(null);
    setExecution(null);
    const controller = new AbortController();
    exampleAbort.current?.abort();
    exampleAbort.current = controller;
    setLoadingExample(true);
    setError(null);
    setSource(null);
    try {
      const { trace, progress } = await getRecordedExecution(controller.signal);
      if (controller.signal.aborted) return;
      setRunId(null);
      setExecution({ mode: 'recorded', trace, progress });
      window.history.pushState({}, '', window.location.pathname);
    } catch (reason: unknown) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : 'Could not load recorded execution.');
    } finally {
      if (!controller.signal.aborted) setLoadingExample(false);
    }
  }

  const lastEvent = trace?.events.at(-1);
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href={window.location.pathname}>
          <span className="brand-symbol">
            s<span>∴</span>
          </span>
          <span>
            SOLUTION<span className="brand-light"> / UNDER THE HOOD</span>
          </span>
        </a>
        <nav>
          <span className="project-tag">PORTFOLIO PROJECT 02</span>
          <a href={repositoryUrl} target="_blank" rel="noreferrer">
            View source <span>↗</span>
          </a>
        </nav>
      </header>
      <main>
        <section className="title-bar">
          <div>
            <p className="overline">
              <span className="orange-dot" /> A BACKEND YOU CAN EXPLORE
            </p>
            <h1>
              Follow the evidence.<span> Inspect the engine.</span>
            </h1>
            <p className="subtitle">
              An executable map of retrieval, orchestration, and grounded AI decisions.
            </p>
          </div>
          <div className="run-actions">
            <button className="secondary-button" disabled={exampleBusy} onClick={() => void loadExample()}>
              {loadingExample ? 'Loading…' : 'Explore recorded run'}
            </button>
            <button className="primary-button" disabled={busy} onClick={() => void start()}>
              <span>{starting || pending ? '◌' : '▶'}</span>
              {starting ? 'Starting…' : pending ? 'Workflow running' : 'Run live workflow'}
            </button>
          </div>
        </section>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            {runId && (
              <button className="text-button" onClick={() => setRefresh((value) => value + 1)}>
                Reconnect
              </button>
            )}
          </div>
        )}
        <section className="execution-bar" aria-label="Execution metadata">
          <div className="execution-mode">
            <i data-live={pending} />
            <strong>
              {execution?.mode === 'recorded'
                ? 'RECORDED EXECUTION'
                : execution?.mode === 'live'
                  ? 'LIVE EXECUTION'
                  : 'SYSTEM ARCHITECTURE'}
            </strong>
            {trace && <Status value={trace.status} />}
          </div>
          <div className="run-meta">
            <span>{trace ? `RUN ${trace.runId.slice(0, 8)}` : 'NO RUN SELECTED'}</span>
            <span>
              {trace
                ? trace.executionId
                  ? `n8n #${trace.executionId}`
                  : 'LEGACY RUN'
                : '9 SOURCE DOCUMENTS'}
            </span>
            <span>
              {trace && lastEvent
                ? `${elapsed(trace.createdAt, lastEvent.createdAt)} OBSERVED`
                : '3 REQUIREMENTS'}
            </span>
          </div>
          {execution && (
            <a
              className="text-button"
              href={
                execution.mode === 'recorded'
                  ? '/recorded-execution.json'
                  : `/runs/${execution.trace.runId}/trace`
              }
              download={`execution-${execution.trace.runId}.json`}
            >
              Export trace ↓
            </a>
          )}
        </section>
        <div className="workbench">
          <section className="diagram-panel" aria-label="Interactive backend flow">
            <div className="diagram-toolbar">
              <div>
                <span className="overline">Execution map</span>
                <span className="toolbar-note">Select a step to inspect its work</span>
                <span className="scroll-hint">Scroll map →</span>
              </div>
              <div className="legend">
                <span>
                  <i className="legend-done" />
                  Recorded
                </span>
                <span>
                  <i className="legend-running" />
                  Running
                </span>
                <span>
                  <i />
                  Waiting
                </span>
              </div>
            </div>
            <div className="diagram-scroll">
              <div className="diagram">
                <div className="lane-label orchestration-label">01 / DISPATCH & ORCHESTRATION</div>
                <div className="rag-boundary">
                  <span>02 / RAG ASSESSMENT PIPELINE</span>
                  <small>NestJS API · repeated for each requirement</small>
                </div>
                <div className="lane-label output-label">03 / VERIFIED OUTPUT</div>
                <svg
                  className="connections"
                  viewBox="0 0 930 585"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" />
                    </marker>
                  </defs>
                  <path
                    className={eventsFor(trace, 'workflow', questionId).length ? 'traversed' : ''}
                    d="M225 110 H365"
                  />
                  <path
                    className={
                      eventsFor(trace, 'workflow', questionId).length ? 'traversed dashed' : 'dashed'
                    }
                    d="M555 110 H695"
                  />
                  <path
                    className={eventsFor(trace, 'retrieval', questionId).length ? 'traversed' : ''}
                    d="M460 151 V190 H130 V275"
                  />
                  <path
                    className={eventsFor(trace, 'generation', questionId).length ? 'traversed' : ''}
                    d="M225 320 H255"
                  />
                  <path
                    className={eventsFor(trace, 'validation', questionId).length ? 'traversed' : ''}
                    d="M445 320 H475"
                  />
                  <path
                    className={eventsFor(trace, 'persistence', questionId).length ? 'traversed' : ''}
                    d="M665 320 H695"
                  />
                  <path
                    className={eventsFor(trace, 'dossier', questionId).length ? 'traversed' : ''}
                    d="M790 361 V405 H460 V465"
                  />
                  <path
                    className={eventsFor(trace, 'completion', questionId).length ? 'traversed' : ''}
                    d="M555 510 H695"
                  />
                </svg>
                <span className="connection-label request-label">POST / webhook</span>
                <span className="connection-label snapshot-label">pin revision</span>
                <span className="connection-label repeat-label">3 requirement items</span>
                <span className="connection-label saved-label">read + verify all 3 saved assessments</span>
                {nodes.map((node) => (
                  <button
                    key={node.id}
                    className={`flow-node node-${node.id}`}
                    style={{ left: `${(node.x / 930) * 100}%`, top: node.y }}
                    data-selected={selected === node.id}
                    data-status={nodeStatus(trace, node.id, questionId)}
                    onClick={() => setSelected(node.id)}
                    aria-pressed={selected === node.id}
                    aria-label={`${node.title}: ${nodeStatus(trace, node.id, questionId)}`}
                  >
                    <div className="node-top">
                      <span>{node.technology}</span>
                      <span className="node-state">
                        {nodeStatus(trace, node.id, questionId) === 'succeeded'
                          ? '✓'
                          : nodeStatus(trace, node.id, questionId) === 'failed'
                            ? '!'
                            : node.number}
                      </span>
                    </div>
                    <strong>{node.title}</strong>
                    <small>{node.caption}</small>
                  </button>
                ))}
                <div className="failure-note">
                  <span>↳ FAILURE ROUTE</span>
                  <p>n8n Error Trigger → mark run failed</p>
                  <small>Retries and failed attempts remain in the trace.</small>
                </div>
              </div>
            </div>
            <div className="requirement-picker">
              <div className="section-label">
                <span>Follow a requirement through the RAG pipeline</span>
                <span>3 inputs</span>
              </div>
              <div className="requirement-buttons">
                {requirements.map((requirement, index) => (
                  <button
                    key={requirement.id}
                    aria-pressed={questionId === requirement.id}
                    onClick={() => setSelectedQuestion(requirement)}
                  >
                    <span>0{index + 1}</span>
                    <strong>{requirement.label}</strong>
                    <i
                      data-verdict={
                        execution?.progress.assessments.find((a) => a.questionId === requirement.id)?.verdict
                      }
                    />
                  </button>
                ))}
              </div>
              <p className="active-question">
                <span>INPUT</span>“{selectedQuestion.question}”
              </p>
            </div>
          </section>
          <Inspector selected={selected} questionId={questionId} execution={execution} onSource={setSource} />
        </div>
        <section className="event-console" aria-label="Execution event log">
          <div className="console-heading">
            <div>
              <span className="console-icon">≡</span>
              <h2>Execution log</h2>
              <span className="count-tag">{trace?.events.length ?? 0} events</span>
            </div>
            <span className="fine-print">
              {execution?.mode === 'recorded'
                ? `Captured ${new Date(execution.trace.createdAt).toLocaleString()}`
                : pending
                  ? 'Polling durable events every 1.2 seconds'
                  : 'Persisted evidence · ordered by event ID'}
            </span>
          </div>
          {!trace?.events.length ? (
            <div className="console-empty">
              <code>~/solution-assessment</code>
              <span>Ready. Run the workflow to watch the backend work, or explore a recorded execution.</span>
              <i />
            </div>
          ) : (
            <div className="event-table">
              <div className="event-table-heading">
                <span>ELAPSED</span>
                <span>STAGE</span>
                <span>REQUIREMENT</span>
                <span>STATE</span>
                <span>ATTEMPT</span>
              </div>
              {trace.events.map((event) => (
                <button
                  key={event.id}
                  className="event-row"
                  onClick={() => {
                    setSelected(event.stage);
                    const question = requirements.find((item) => item.id === event.questionId);
                    if (question) setSelectedQuestion(question);
                  }}
                >
                  <time>+{elapsed(trace.createdAt, event.createdAt)}</time>
                  <strong>{event.stage}</strong>
                  <span>{requirements.find((r) => r.id === event.questionId)?.label ?? 'Execution'}</span>
                  <Status value={event.status} />
                  <code>{event.attemptId?.slice(0, 8) ?? '—'}</code>
                </button>
              ))}
            </div>
          )}
        </section>
        <footer>
          <span>
            <b>RAG</b> grounded in versioned evidence <span className="footer-cross">×</span> <b>n8n</b>{' '}
            coordinating real work
          </span>
          <span>
            Built by{' '}
            <a href="https://github.com/BlissFelix3" target="_blank" rel="noreferrer">
              Bliss Felix ↗
            </a>
          </span>
        </footer>
      </main>
      {source && execution && (
        <SourceDialog
          key={`${execution.trace.runId}-${source.path}-${source.quote}`}
          execution={execution}
          selection={source}
          onClose={() => setSource(null)}
        />
      )}
    </div>
  );
}
