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
import { executionMessage, replayExecution, repositoryUrl, type NodeId } from './flow.js';
import { BackendFlow } from './BackendFlow.js';
import { Status } from './Status.js';
import { DocumentReader } from './DocumentReader.js';
import { ExecutionActivity } from './ExecutionActivity.js';
import { AssessmentResults } from './AssessmentResults.js';

function initialRunId(): string | null {
  const id = new URLSearchParams(window.location.search).get('run');
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

export function App() {
  const [draft, setDraft] = useState(['']);
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
    setDraft(['']);
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
  const followedQuestion = cursor !== null ? (latest?.questionId ?? questionId) : questionId;
  const question = submitted.find((item) => item.id === followedQuestion) ?? submitted[0];
  const mode =
    execution?.mode === 'recorded'
      ? 'Recorded example'
      : trace
        ? 'Your live request'
        : 'Waiting for your request';
  const inspectedQuestion = question?.id ?? requirements[0].id;
  const observation = executionMessage(trace, starting);

  return (
    <div className="assessment-app">
      <header className="app-header">
        <a className="app-brand" href="/" aria-label="Solution assessment home">
          <span className="brand-symbol" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            Solution<span className="brand-secondary"> / assessment</span>
          </span>
        </a>
        <span className="header-context">A question. An answer. The evidence.</span>
        <nav aria-label="Project links">
          <span className="portfolio-label">By Bliss Felix</span>
          <a href={repositoryUrl} target="_blank" rel="noreferrer">
            View project ↗
          </a>
        </nav>
      </header>
      <main className="workspace">
        <DocumentReader execution={execution} />
        <section className="assessment-pane" aria-labelledby="assessment-heading">
          <header className="assistant-toolbar">
            <span>
              <span className="assistant-dot" /> Assessment assistant
            </span>
            {view && (
              <button disabled={busy} onClick={reset}>
                ＋ New question
              </button>
            )}
            {!view && <span className="workspace-badge">Cited answers</span>}
          </header>
          <div className="assistant-body">
            {!view && (
              <>
                <div className="assistant-welcome">
                  <span className="assistant-emblem" aria-hidden="true">
                    <svg viewBox="0 0 32 32">
                      <path d="M16 3v26M3 16h26M7 7l18 18M7 25 25 7" />
                      <circle cx="16" cy="16" r="6" />
                    </svg>
                  </span>
                  <div className="welcome-copy">
                    <h1 id="assessment-heading">What do you need to know?</h1>
                    <p className="pane-description">
                      Read the documentation. Ask what the product can do. Every answer comes with
                      evidence you can open and verify.
                    </p>
                  </div>
                </div>
                <div className="suggestions">
                  <span className="suggestions-label">Start with a question</span>
                  {requirements.map((item, index) => (
                    <button
                      key={item.id}
                      disabled={busy}
                      onClick={() => {
                        setDraft([item.question]);
                        document.getElementById('requirement-0')?.focus();
                      }}
                    >
                      <span className="suggestion-index">0{index + 1}</span>
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.question}</small>
                      </span>
                      <span className="suggestion-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  ))}
                </div>
                <form
                  className="requirements-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void start();
                  }}
                >
                  <fieldset disabled={busy}>
                    {draft.map((value, index) => (
                      <div className="requirement-input" key={index}>
                        <label htmlFor={`requirement-${index}`}>
                          {draft.length === 1 ? 'Your question' : `Question ${index + 1}`}
                          <span aria-hidden="true">{value.length} / 500</span>
                        </label>
                        {draft.length > 1 && (
                          <button
                            type="button"
                            className="remove-input"
                            aria-label={`Remove question ${index + 1}`}
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
                          placeholder="What do you need the product to do?"
                          onChange={(event) =>
                            setDraft(
                              draft.map((item, i) => (i === index ? event.target.value : item)),
                            )
                          }
                        />
                      </div>
                    ))}
                    <div className="composer-actions">
                      <button
                        type="button"
                        className="add-requirement"
                        disabled={draft.length >= 3}
                        onClick={() => setDraft([...draft, ''])}
                      >
                        ＋ Add question
                      </button>
                      <button
                        className="submit-assessment"
                        type="submit"
                        disabled={draft.some((value) => !value.trim())}
                      >
                        {starting ? 'Starting…' : 'Ask question'} <span aria-hidden="true">↑</span>
                      </button>
                    </div>
                  </fieldset>
                </form>
                <p className="submission-note">
                  Demo questions and execution evidence are public. Use fictional requirements.
                </p>
              </>
            )}
            {view && (
              <h1 className="sr-only" id="assessment-heading">
                Your assessment
              </h1>
            )}
            {error && (
              <div className="error-banner" role="alert">
                <p>{error}</p>
                {runId && (
                  <button onClick={() => setRefresh((value) => value + 1)}>Refresh status</button>
                )}
              </div>
            )}
            <details className="under-hood" open={pending || starting}>
              <summary>
                <span
                  className="activity-symbol"
                  data-busy={pending || starting}
                  aria-hidden="true"
                >
                  ⌘
                </span>
                <span>
                  <strong aria-live="polite">
                    {view || starting ? observation : 'Under the hood'}
                  </strong>
                  <small>
                    {view ? `Under the hood · ${mode}` : 'Retrieval, model calls & n8n execution'}
                  </small>
                </span>
                <span className="disclosure-arrow" aria-hidden="true">
                  ⌄
                </span>
              </summary>
              <div className="under-hood-content">
                {trace && (
                  <div className="run-identity">
                    <span>n8n execution #{trace.executionId ?? 'unavailable'}</span>
                    <Status value={trace.status} />
                    <button onClick={() => inspect('sources')}>Source revision ↗</button>
                  </div>
                )}
                {view && (
                  <ExecutionActivity
                    execution={view}
                    questionId={inspectedQuestion}
                    onInspect={inspect}
                    onSource={setSource}
                  />
                )}
                <details className="workflow-disclosure" open={view ? undefined : true}>
                  <summary>
                    <span className="n8n-mark">⤳</span> n8n workflow{' '}
                    <span>Nodes & connections ↗</span>
                  </summary>
                  <BackendFlow onSelect={inspect} trace={trace} questionId={inspectedQuestion} />
                </details>
                {execution?.mode === 'recorded' && (
                  <div className="replay-controls">
                    <button onClick={replay}>
                      {playing ? 'Ⅱ Pause' : '▶ Replay'} recorded run
                    </button>
                    <label>
                      Recorded events
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
              </div>
            </details>
            {view && question && (
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
            )}
            {!view && (
              <div className="example-actions">
                <span>Take a look first?</span>
                <button disabled={busy} onClick={() => void recorded()}>
                  {loadingExample ? 'Loading…' : 'Open recorded example'}{' '}
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
            )}
          </div>
          <footer className="assistant-footer">
            <span>Answers grounded in documentation</span>
            <span>Sources → assessment</span>
          </footer>
        </section>
      </main>
      {selected && (
        <Inspector
          key={selected}
          selected={selected}
          questionId={inspectedQuestion}
          execution={view}
          onSource={setSource}
          onClose={() => setSelected(null)}
        />
      )}
      {source && execution && (
        <SourceDialog execution={execution} selection={source} onClose={() => setSource(null)} />
      )}
    </div>
  );
}
