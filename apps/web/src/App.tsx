import { useEffect, useRef, useState } from 'react';
import {
  getRunProgress,
  getRunTrace,
  getRecordedExecution,
  startDemo,
  requirements,
} from './api.js';
import {
  Inspector,
  SourceDialog,
  type Execution,
  type SourceSelection,
} from './ExecutionInspector.js';
import { elapsed, nodes, nodeStatus, replayExecution, repositoryUrl, type NodeId } from './flow.js';
import { BackendFlow } from './BackendFlow.js';
import { Status } from './Status.js';
import { AssessmentResults } from './AssessmentResults.js';

function initialRunId(): string | null {
  const id = new URLSearchParams(window.location.search).get('run');
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

export function App() {
  const [draft, setDraft] = useState(() => requirements.map((item) => item.question));
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [questionId, setQuestionId] = useState(requirements[0].id);
  const [starting, setStarting] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [source, setSource] = useState<SourceSelection | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const exampleAbort = useRef<AbortController | null>(null);
  const navigation = useRef(0);
  const runLocation = useRef(window.location.pathname + window.location.search);
  const pending =
    execution?.mode === 'live' &&
    (execution.trace.status === 'pending' || execution.progress.status === 'pending');
  const busy =
    starting || loadingExample || (runId !== null && ((!execution && !error) || pending));

  useEffect(() => {
    const onPop = () => {
      const location = window.location.pathname + window.location.search;
      if (location === runLocation.current) return;
      runLocation.current = location;
      navigation.current += 1;
      exampleAbort.current?.abort();
      setLoadingExample(false);
      setStarting(false);
      setSource(null);
      setSelected(null);
      setRunId(initialRunId());
      setRefresh((value) => value + 1);
      setExecution(null);
      setError(null);
      setPlaying(false);
      setCursor(null);
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
        if (JSON.stringify(trace.requirements) !== JSON.stringify(progress.requirements))
          throw new Error('The results and trace belong to different requirements.');
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

  useEffect(() => {
    if (!playing || cursor === null || execution?.mode !== 'recorded') return;
    if (cursor >= execution.trace.events.length) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setCursor(cursor + 1), 650);
    return () => window.clearTimeout(timer);
  }, [playing, cursor, execution]);

  async function start() {
    if (busy) return;
    exampleAbort.current?.abort();
    const currentNavigation = ++navigation.current;
    setStarting(true);
    setPlaying(false);
    setCursor(null);
    setError(null);
    setSource(null);
    setSelected(null);
    try {
      const id = await startDemo(draft);
      if (currentNavigation !== navigation.current) return;
      setExecution(null);
      setRunId(id);
      setRefresh((value) => value + 1);
      window.history.pushState({}, '', `?run=${encodeURIComponent(id)}`);
      runLocation.current = window.location.pathname + window.location.search;
    } catch (reason: unknown) {
      if (currentNavigation === navigation.current)
        setError(reason instanceof Error ? reason.message : 'Could not start assessment.');
    } finally {
      if (currentNavigation === navigation.current) setStarting(false);
    }
  }

  async function recorded() {
    if (busy) return;
    const currentNavigation = ++navigation.current;
    const controller = new AbortController();
    exampleAbort.current?.abort();
    exampleAbort.current = controller;
    setLoadingExample(true);
    setError(null);
    setSelected(null);
    setSource(null);
    setPlaying(false);
    setCursor(null);
    try {
      const saved = await getRecordedExecution(controller.signal);
      if (currentNavigation !== navigation.current || controller.signal.aborted) return;
      setRunId(null);
      setExecution({ mode: 'recorded', ...saved });
      window.history.pushState({}, '', window.location.pathname);
      runLocation.current = window.location.pathname + window.location.search;
    } catch (reason: unknown) {
      if (!controller.signal.aborted && currentNavigation === navigation.current)
        setError(reason instanceof Error ? reason.message : 'Could not load recorded example.');
    } finally {
      if (currentNavigation === navigation.current) setLoadingExample(false);
    }
  }

  function inspect(id: NodeId) {
    setPlaying(false);
    if (question) setQuestionId(question.id);
    setSelected(id);
  }
  function replay() {
    if (execution?.mode !== 'recorded') return;
    setSelected(null);
    setSource(null);
    if (cursor === null || cursor >= execution.trace.events.length) setCursor(0);
    setPlaying(!playing);
  }
  function reset() {
    navigation.current += 1;
    exampleAbort.current?.abort();
    if (execution) setDraft(execution.trace.requirements.map((item) => item.question));
    setRunId(null);
    setExecution(null);
    setError(null);
    setCursor(null);
    setPlaying(false);
    setSelected(null);
    setSource(null);
    window.history.pushState({}, '', window.location.pathname);
    runLocation.current = window.location.pathname + window.location.search;
  }

  const view =
    execution && cursor !== null
      ? { ...execution, ...replayExecution(execution.trace, execution.progress, cursor) }
      : execution;
  const trace = view?.trace ?? null;
  const latest = trace?.events.at(-1);
  const submitted = trace?.requirements ?? [];
  const followedQuestion =
    cursor !== null || (pending && selected === null)
      ? (latest?.questionId ?? questionId)
      : questionId;
  const question = submitted.find((item) => item.id === followedQuestion) ?? submitted[0];
  const active = playing
    ? (latest?.stage ?? null)
    : pending
      ? (nodes.find(
          (node) =>
            node.id !== 'workflow' &&
            node.id !== 'sources' &&
            nodeStatus(trace, node.id, latest?.questionId ?? question?.id ?? '') === 'started',
        )?.id ?? 'workflow')
      : null;
  const completed = view?.progress.assessments.length ?? 0;
  const mode =
    execution?.mode === 'recorded'
      ? 'Recorded example'
      : trace
        ? 'Your live request'
        : 'Waiting for your request';
  const inspectedQuestion = question?.id ?? requirements[0].id;
  const scopedEvents =
    trace?.events.filter((event) => !event.questionId || event.questionId === inspectedQuestion) ??
    [];
  const context = [...scopedEvents]
    .reverse()
    .find((event) => event.stage === 'retrieval' && event.status === 'succeeded');
  const candidateCount = typeof context?.data.count === 'number' ? context.data.count : null;

  return (
    <div className="assessment-app">
      <header className="app-header">
        <a className="app-brand" href="/" aria-label="Solution assessment home">
          <span className="brand-symbol" aria-hidden="true">
            s<span>↗</span>
          </span>
          <span>
            Solution assessment<span className="brand-subtitle">Evidence before promises.</span>
          </span>
        </a>
        <nav aria-label="Project links">
          <span className="portfolio-label">A backend engineering project by Bliss Felix</span>
          <a href={repositoryUrl} target="_blank" rel="noreferrer">
            View code <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main className="workspace">
        <section className="assessment-pane" aria-labelledby="assessment-heading">
          <div className="pane-heading">
            <div>
              <span className="section-kicker">THE AGENT</span>
              <h1 id="assessment-heading">Will it work for you?</h1>
            </div>
            <span className="corner-index">01</span>
          </div>
          <p className="pane-description">
            Ask what the platform can support. Get an assessment grounded in its documentation.
          </p>
          <details className="corpus-note">
            <summary>▤ Fictional platform documentation</summary>
            <p>
              Versioned product docs covering SSO, account events and webhook delivery. Ask about
              these capabilities or test an undocumented claim.
            </p>
          </details>
          {!view ? (
            <form
              className="requirements-form"
              onSubmit={(event) => {
                event.preventDefault();
                void start();
              }}
            >
              <div className="form-heading">
                <h2>Your requirements</h2>
                <span>{draft.length} / 3</span>
              </div>
              <fieldset disabled={busy}>
                {draft.map((value, index) => (
                  <div className="requirement-input" key={index}>
                    <label htmlFor={`requirement-${index}`}>Requirement {index + 1}</label>
                    {draft.length > 1 && (
                      <button
                        type="button"
                        className="remove-input"
                        aria-label={`Remove requirement ${index + 1}`}
                        onClick={() => setDraft(draft.filter((_, i) => i !== index))}
                      >
                        ×
                      </button>
                    )}
                    <textarea
                      id={`requirement-${index}`}
                      required
                      maxLength={500}
                      rows={2}
                      value={value}
                      placeholder="Can the platform…?"
                      onChange={(event) =>
                        setDraft(draft.map((item, i) => (i === index ? event.target.value : item)))
                      }
                    />
                  </div>
                ))}
                {draft.length < 3 && (
                  <button
                    type="button"
                    className="add-requirement"
                    onClick={() => setDraft([...draft, ''])}
                  >
                    + Add a requirement
                  </button>
                )}
                <button className="submit-assessment" type="submit">
                  {starting
                    ? 'Starting assessment…'
                    : pending
                      ? 'Assessing your requirements…'
                      : 'Assess requirements'}
                  <span aria-hidden="true">{starting || pending ? '◌' : '↗'}</span>
                </button>
              </fieldset>
              <p className="submission-note">
                Demo inputs and execution evidence are publicly inspectable.
              </p>
            </form>
          ) : (
            <div className="submitted-heading">
              <span>
                {submitted.length} requirement{submitted.length === 1 ? '' : 's'} submitted
              </span>
              <button onClick={reset}>Edit & assess again ↗</button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <p>{error}</p>
              {runId && (
                <button onClick={() => setRefresh((value) => value + 1)}>Refresh status</button>
              )}
            </div>
          )}
          {view && question ? (
            <AssessmentResults
              execution={view}
              questionId={inspectedQuestion}
              onQuestion={(id) => {
                setPlaying(false);
                setCursor(null);
                setQuestionId(id);
              }}
              onSource={setSource}
            />
          ) : (
            <div className="results-placeholder">
              <span aria-hidden="true">↳</span>
              <p>Your assessment and cited evidence will appear here.</p>
            </div>
          )}
          <div className="example-actions">
            <button disabled={busy} onClick={() => void recorded()}>
              {loadingExample ? 'Loading…' : 'Explore a completed example'} ↗
            </button>
          </div>
        </section>

        <section className="execution-pane" aria-labelledby="execution-heading">
          <div className="execution-heading">
            <div>
              <span className="section-kicker">THE SAME REQUEST, UNDER THE HOOD</span>
              <h2 id="execution-heading">Watch the system work.</h2>
            </div>
            <span className="execution-mode" data-live={pending}>
              <i />
              {mode}
            </span>
          </div>
          <div className="execution-canvas">
            <div className="canvas-topline">
              <span>INPUT → EVIDENCE → ANSWER</span>
              <span>RAG × n8n</span>
            </div>
            <BackendFlow active={active} onSelect={inspect} />
            <div className="canvas-bottomline">
              <span>
                {trace
                  ? `${completed} / ${submitted.length} answers saved`
                  : 'Submit a requirement to start the flow'}
              </span>
              <span>{trace ? `n8n #${trace.executionId ?? '—'}` : 'Live execution'}</span>
            </div>
          </div>
          <div className="flow-stage-heading">
            <strong>Execution stages</strong>
            <span>Select a stage to inspect its actual data ↘</span>
          </div>
          <div className="execution-stages" aria-label="Backend stages">
            {nodes.map((node) => {
              const state = nodeStatus(trace, node.id, inspectedQuestion);
              return (
                <button
                  key={node.id}
                  data-state={state}
                  data-active={active === node.id}
                  onClick={() => inspect(node.id)}
                  aria-label={`${node.title}: ${state}. Inspect stage`}
                >
                  <span className="stage-number">{node.number}</span>
                  <strong>{node.title}</strong>
                  <span className="stage-state">
                    {state === 'succeeded'
                      ? '✓'
                      : state === 'started'
                        ? '◌'
                        : state === 'failed'
                          ? '×'
                          : '·'}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="execution-observation" aria-live="polite">
            <span className="observation-icon" aria-hidden="true">
              ⌁
            </span>
            <div>
              <strong>
                {latest ? `${latest.stage} · ${latest.status}` : 'Ready to observe your request'}
              </strong>
              <p>
                {latest?.questionId
                  ? submitted.find((item) => item.id === latest.questionId)?.question
                  : trace
                    ? `Run ${trace.runId}`
                    : 'The illustration responds to recorded backend events. Each stage opens its evidence, payload and implementation.'}
              </p>
            </div>
            {latest && trace && (
              <span className="event-time">+{elapsed(trace.createdAt, latest.createdAt)}</span>
            )}
          </div>
          {trace && (
            <div className="execution-metrics">
              <button onClick={() => inspect('retrieval')}>
                <span>RETRIEVED CONTEXT</span>
                <strong>{candidateCount === null ? '—' : `${candidateCount} documents`}</strong>
              </button>
              <button onClick={() => inspect('validation')}>
                <span>CITATION CHECKS</span>
                <strong>
                  {nodeStatus(trace, 'validation', inspectedQuestion) === 'succeeded'
                    ? 'Passed'
                    : nodeStatus(trace, 'validation', inspectedQuestion) === 'failed'
                      ? 'Failed'
                      : trace.status === 'failed' || trace.status === 'timed_out'
                        ? 'Not completed'
                        : 'Awaiting validation'}
                </strong>
              </button>
              <button onClick={() => inspect('sources')}>
                <span>PINNED REVISION</span>
                <strong>{trace.sourceRevisionId.slice(0, 20)}…</strong>
              </button>
            </div>
          )}
          {execution?.mode === 'recorded' && (
            <div className="replay-controls">
              <button onClick={replay}>{playing ? 'Ⅱ Pause' : '▶ Replay'} actual execution</button>
              <label>
                Recorded events{' '}
                <input
                  type="range"
                  min={0}
                  max={execution.trace.events.length}
                  value={cursor ?? execution.trace.events.length}
                  onChange={(event) => {
                    setPlaying(false);
                    setCursor(Number(event.target.value));
                  }}
                />
              </label>
              <span>
                {trace?.events.length} / {execution.trace.events.length}
              </span>
            </div>
          )}
          <details className="execution-log">
            <summary>
              Event log<span>{trace?.events.length ?? 0} recorded events</span>
            </summary>
            {trace?.events.length ? (
              <div>
                {trace.events.map((event, index) => (
                  <button
                    key={event.id}
                    onClick={() => {
                      setPlaying(false);
                      if (execution?.mode === 'recorded') setCursor(index + 1);
                      if (event.questionId) setQuestionId(event.questionId);
                      setSelected(event.stage);
                    }}
                  >
                    <span>+{elapsed(trace.createdAt, event.createdAt)}</span>
                    <strong>{event.stage}</strong>
                    <Status value={event.status} />
                    <span>
                      {event.questionId
                        ? submitted.findIndex((item) => item.id === event.questionId) + 1
                        : '—'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p>No execution events yet.</p>
            )}
          </details>
          <div className="execution-footnote">
            <span>PostgreSQL retrieval · Gemini generation · strict citation validation</span>
            <span>Inspect every boundary.</span>
          </div>
        </section>
      </main>
      <nav className="mobile-workspace-nav" aria-label="Workspace panels">
        <a href="#assessment-heading">↳ Assessment</a>
        <a href="#execution-heading">⌁ Under the hood</a>
      </nav>
      <footer className="app-footer">
        <span>
          Built by{' '}
          <a href="https://github.com/BlissFelix3" target="_blank" rel="noreferrer">
            Bliss Felix ↗
          </a>
        </span>
        <span>Use the agent. Inspect the engineering.</span>
      </footer>
      {selected && (
        <Inspector
          selected={selected}
          questionId={inspectedQuestion}
          execution={view}
          onSource={setSource}
          onClose={() => setSelected(null)}
        />
      )}
      {source && view && (
        <SourceDialog
          key={`${view.trace.runId}-${source.path}-${source.quote}`}
          execution={view}
          selection={source}
          onClose={() => setSource(null)}
        />
      )}
    </div>
  );
}
