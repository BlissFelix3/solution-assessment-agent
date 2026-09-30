import { useEffect, useRef, useState } from 'react';
import { getRunProgress, getRunTrace, getRecordedExecution, startDemo } from './api.js';
import {
  Inspector,
  SourceDialog,
  type Execution,
  type SourceSelection,
} from './ExecutionInspector.js';
import {
  elapsed,
  nodes,
  nodeStatus,
  replayExecution,
  repositoryUrl,
  requirements,
  type NodeId,
} from './flow.js';
import { BackendFlow } from './BackendFlow.js';
import { Status } from './Status.js';

function initialRunId(): string | null {
  const id = new URLSearchParams(window.location.search).get('run');
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

export function App() {
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [questionId, setQuestionId] = useState(requirements[0].id);
  const [starting, setStarting] = useState(false);
  const [loadingExample, setLoadingExample] = useState(!initialRunId());
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [source, setSource] = useState<SourceSelection | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const exampleAbort = useRef<AbortController | null>(null);
  const navigation = useRef(0);
  const pending =
    execution?.mode === 'live' &&
    (execution.trace.status === 'pending' || execution.progress.status === 'pending');
  const busy = starting || loadingExample || (runId !== null && (!execution || pending));

  useEffect(() => {
    const onPop = () => {
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
    if (runId) return;
    const controller = new AbortController();
    exampleAbort.current?.abort();
    exampleAbort.current = controller;
    setLoadingExample(true);
    void getRecordedExecution(controller.signal)
      .then(({ trace, progress }) => {
        if (!controller.signal.aborted) {
          setExecution({ mode: 'recorded', trace, progress });
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'Could not load the recorded execution.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingExample(false);
      });
    return () => controller.abort();
  }, [runId, refresh]);

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
    const currentNavigation = navigation.current;
    setStarting(true);
    setPlaying(false);
    setCursor(null);
    setError(null);
    setSource(null);
    setSelected(null);
    try {
      const id = await startDemo();
      if (currentNavigation !== navigation.current) return;
      setExecution(null);
      setRunId(id);
      window.history.pushState({}, '', `?run=${encodeURIComponent(id)}`);
    } catch (reason: unknown) {
      if (currentNavigation === navigation.current)
        setError(reason instanceof Error ? reason.message : 'Could not start execution.');
    } finally {
      if (currentNavigation === navigation.current) setStarting(false);
    }
  }

  function recorded() {
    if (starting || loadingExample) return;
    navigation.current += 1;
    setPlaying(false);
    setCursor(null);
    setSource(null);
    setSelected(null);
    setExecution(null);
    setRunId(null);
    setRefresh((value) => value + 1);
    window.history.pushState({}, '', window.location.pathname);
  }

  function inspect(id: NodeId) {
    setPlaying(false);
    setSelected(id);
  }
  function chooseQuestion(id: string) {
    setPlaying(false);
    setCursor(null);
    setQuestionId(id);
  }
  function replay() {
    if (execution?.mode !== 'recorded') return;
    setSelected(null);
    setSource(null);
    if (cursor === null || cursor >= execution.trace.events.length) setCursor(0);
    setPlaying(!playing);
  }

  const view =
    execution && cursor !== null
      ? {
          ...execution,
          ...replayExecution(execution.trace, execution.progress, cursor),
        }
      : execution;
  const trace = view?.trace ?? null;
  const replayEvent = cursor !== null ? trace?.events.at(-1) : null;
  const followedQuestion = replayEvent?.questionId ?? questionId;
  const question = requirements.find((item) => item.id === followedQuestion) ?? requirements[0];
  const assessment = view?.progress.assessments.find((item) => item.questionId === question.id);
  const active = playing
    ? (replayEvent?.stage ?? null)
    : pending
      ? (nodes.find(
          (node) =>
            node.id !== 'workflow' &&
            node.id !== 'sources' &&
            nodeStatus(trace, node.id, question.id) === 'started',
        )?.id ?? null)
      : null;
  const latest = trace?.events.at(-1);
  const lastRecordedEvent = execution?.trace.events.at(-1);
  const observedDuration =
    execution && lastRecordedEvent
      ? elapsed(execution.trace.createdAt, lastRecordedEvent.createdAt)
      : '—';
  const mode =
    execution?.mode === 'recorded'
      ? 'Recorded execution'
      : execution?.mode === 'live'
        ? 'Live execution'
        : loadingExample
          ? 'Loading recording'
          : 'Architecture';

  return (
    <div className="exhibition">
      <header className="site-header">
        <a
          className="identity"
          href={window.location.pathname}
          aria-label="Solution assessment agent home"
        >
          <span className="identity-mark" aria-hidden="true">
            ✳
          </span>
          <span>
            solution<span className="identity-slash"> / </span>
            <b>under the hood</b>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#system">The system</a>
          <a href="#execution-log">Execution log</a>
          <a className="source-link" href={repositoryUrl} target="_blank" rel="noreferrer">
            GitHub <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main>
        <section className="workbench" id="system" aria-label="Interactive backend execution">
          <div className="hero">
            <div className="hero-copy">
              <p className="eyebrow">
                <span className="project-dot" /> BACKEND ENGINEERING / 02
              </p>
              <h1>
                The answer.
                <br />
                <span>Unpacked.</span>
              </h1>
              <p className="hero-description">
                Go inside a working AI system. Follow the webhooks, the workflow, and the evidence
                behind every answer.
              </p>
              <div className="hero-actions">
                <button className="live-button" disabled={busy} onClick={() => void start()}>
                  {starting ? 'Starting…' : pending ? 'Workflow running' : 'Run the system'}
                  <span aria-hidden="true">{starting || pending ? '◌' : '↗'}</span>
                </button>
                <button
                  className="hero-replay"
                  onClick={replay}
                  disabled={execution?.mode !== 'recorded'}
                >
                  <span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span>
                  {playing ? 'Pause replay' : 'Watch a replay'}
                </button>
              </div>
              <div className="hero-footnote">
                <span>RAG</span>
                <i /> <span>n8n</span>
                <i /> <span>NestJS</span>
                <i /> <span>PostgreSQL</span>
              </div>
            </div>
            <BackendFlow active={active} onSelect={inspect} />
            <div className="scene-status">
              <span className="execution-label">
                <i data-live={pending} />
                {mode}
              </span>
              <span>
                {trace
                  ? `n8n #${trace.executionId ?? '—'} · ${cursor !== null ? 'playback' : trace.status.replaceAll('_', ' ')}`
                  : 'Connecting…'}
              </span>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setRefresh((value) => value + 1)}>Reconnect ↗</button>
            </div>
          )}
          <div className="pipeline-heading">
            <span className="eyebrow">THE COMPLETE JOURNEY</span>
            <span>
              Select any stage to open its evidence <span aria-hidden="true">↘</span>
            </span>
          </div>
          <div className="stage-rail" aria-label="Backend stages">
            {nodes.map((node) => {
              const state = nodeStatus(trace, node.id, question.id);
              return (
                <button
                  key={node.id}
                  className="stage-stop"
                  data-state={state}
                  data-active={active === node.id}
                  aria-label={`${node.title}: ${state}. Inspect stage`}
                  onClick={() => inspect(node.id)}
                >
                  <span className="stop-top">
                    <span>{node.number}</span>
                    <i />
                    <span className="stop-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </span>
                  <strong>{node.title}</strong>
                  <small>{node.technology}</small>
                </button>
              );
            })}
          </div>
          <div className="playback-bar">
            <button
              className="playback-button"
              onClick={replay}
              disabled={execution?.mode !== 'recorded'}
              aria-label={playing ? 'Pause recorded playback' : 'Play recorded execution'}
            >
              <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
            </button>
            <div className="playback-info">
              <strong>
                {playing
                  ? 'Following recorded events'
                  : cursor !== null && cursor < (execution?.trace.events.length ?? 0)
                    ? 'Playback paused'
                    : execution?.mode === 'live'
                      ? 'Observing live execution'
                      : 'Replay the execution'}
              </strong>
              <span>
                {cursor !== null
                  ? 'Original event order · slowed for inspection'
                  : execution?.mode === 'recorded'
                    ? `Captured ${new Date(execution.trace.createdAt).toLocaleDateString()} · ${observedDuration} observed`
                    : pending
                      ? 'Live trace refreshes every 1.2 seconds'
                      : execution
                        ? `${execution.trace.status.replaceAll('_', ' ')} · ${observedDuration} observed`
                        : 'Load an execution to inspect its events'}
              </span>
            </div>
            <div
              className="event-progress"
              aria-label={`${trace?.events.length ?? 0} events visible`}
            >
              {execution?.trace.events.map((event, index) => (
                <button
                  key={event.id}
                  title={`Event ${index + 1}: ${event.stage} ${event.status}`}
                  aria-label={`Inspect event ${index + 1}: ${event.stage} ${event.status}`}
                  data-visible={cursor === null || index < cursor}
                  data-current={index === (cursor ?? 0) - 1}
                  data-stage={event.stage}
                  data-event-status={event.status}
                  onClick={() => {
                    if (execution.mode === 'recorded') setCursor(index + 1);
                    if (event.questionId) setQuestionId(event.questionId);
                    inspect(event.stage);
                  }}
                />
              ))}
            </div>
            <button
              className="recorded-button"
              onClick={recorded}
              disabled={starting || loadingExample}
            >
              {execution?.mode === 'live' ? 'Open recording' : 'Reset'}
            </button>
            <span className="event-count">
              {trace?.events.length ?? 0}
              <span> / {execution?.trace.events.length ?? 0}</span>
            </span>
          </div>
        </section>
        <section className="requirement-section" aria-label="Requirements and results">
          <div className="requirement-intro">
            <p className="eyebrow">ONE SYSTEM. THREE QUESTIONS.</p>
            <h2>Follow the evidence.</h2>
            <p>
              Each requirement travels through the same pipeline. Select one to inspect its
              retrieval, reasoning, and saved result.
            </p>
          </div>
          <div className="requirement-workspace">
            <div className="questions" aria-label="Requirements">
              {requirements.map((item, index) => (
                <button
                  key={item.id}
                  className="question-choice"
                  aria-pressed={question.id === item.id}
                  onClick={() => chooseQuestion(item.id)}
                >
                  <span>0{index + 1}</span>
                  {item.label}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
            <div className="requirement-result">
              <div>
                <p className="eyebrow">THE REQUIREMENT</p>
                <h3>{question.question}</h3>
              </div>
              <div className="answer" data-verdict={assessment?.verdict}>
                {assessment ? (
                  <>
                    <Status value={assessment.verdict} />
                    <p>
                      {assessment.verdict === 'unknown'
                        ? 'The available sources do not establish this requirement.'
                        : assessment.verdict === 'unsupported'
                          ? 'The sources explicitly rule this capability out.'
                          : 'A documented capability, with exact source citations.'}
                    </p>
                    <button className="text-button" onClick={() => inspect('validation')}>
                      Examine the evidence ↗
                    </button>
                  </>
                ) : (
                  <p>
                    {cursor !== null
                      ? 'Play forward to reveal the saved assessment.'
                      : 'The saved assessment appears here when available.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
        <section className="execution-strip" aria-label="Execution identity">
          <div>
            <span>RUN ID</span>
            <code>{trace?.runId ?? 'Awaiting execution'}</code>
          </div>
          <div>
            <span>n8n EXECUTION</span>
            <strong>{trace?.executionId ? `#${trace.executionId}` : '—'}</strong>
          </div>
          <div>
            <span>PINNED REVISION</span>
            <code title={trace?.sourceRevisionId}>
              {trace?.sourceRevisionId ? trace.sourceRevisionId.slice(0, 22) + '…' : '—'}
            </code>
          </div>
          <div>
            <span>LATEST EVENT</span>
            <strong>{latest ? `${latest.stage} / ${latest.status}` : '—'}</strong>
          </div>
          {execution && (
            <a
              className="export-link"
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
        <section className="implementation" aria-labelledby="implementation-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE ENGINEERING BEHIND THE ILLUSTRATION</p>
              <h2 id="implementation-title">Follow the boundaries.</h2>
            </div>
            <span>Click through to implementation ↗</span>
          </div>
          <div className="engineering-notes">
            <button onClick={() => inspect('workflow')}>
              <span className="note-number">01 / ORCHESTRATION</span>
              <h3>n8n moves the work.</h3>
              <p>
                Three requirements. One retry on a failed assessment call. An error workflow reports
                failures.
              </p>
              <span className="note-stack">
                n8n · authenticated HTTP <b>↗</b>
              </span>
            </button>
            <button onClick={() => inspect('retrieval')}>
              <span className="note-number">02 / GROUNDED GENERATION</span>
              <h3>Context comes first.</h3>
              <p>
                Rank documents from one immutable revision. Give Gemini the source text. Check every
                quoted passage.
              </p>
              <span className="note-stack">
                PostgreSQL FTS · Gemini · TypeScript <b>↗</b>
              </span>
            </button>
            <button onClick={() => inspect('persistence')}>
              <span className="note-number">03 / RELIABLE STATE</span>
              <h3>A retry keeps its identity.</h3>
              <p>
                One saved result per run and requirement. State changes and their success events
                commit together.
              </p>
              <span className="note-stack">
                PostgreSQL · idempotent writes <b>↗</b>
              </span>
            </button>
          </div>
        </section>
        <section className="trace-section" id="execution-log" aria-label="Execution event log">
          <button
            className="log-toggle"
            aria-expanded={logOpen}
            aria-controls="event-log"
            onClick={() => setLogOpen(!logOpen)}
          >
            <span>
              <span className="eyebrow">THE DURABLE EVENT TRAIL</span>
              <strong>Inspect all {trace?.events.length ?? 0} captured events.</strong>
            </span>
            <span>{logOpen ? '−' : '+'}</span>
          </button>
          {logOpen && (
            <div id="event-log" className="event-table">
              {trace?.events.map((event, index) => (
                <button
                  key={event.id}
                  onClick={() => {
                    if (execution?.mode === 'recorded') setCursor(index + 1);
                    if (event.questionId) setQuestionId(event.questionId);
                    inspect(event.stage);
                  }}
                >
                  <time>+{elapsed(trace.createdAt, event.createdAt)}</time>
                  <strong>{event.stage}</strong>
                  <span>
                    {requirements.find((item) => item.id === event.questionId)?.label ??
                      'Execution'}
                  </span>
                  <Status value={event.status} />
                  <code>{event.attemptId?.slice(0, 8) ?? '—'}</code>
                  <span>↗</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
      <footer className="site-footer">
        <span>SOLUTION ASSESSMENT AGENT</span>
        <span>
          Built by{' '}
          <a href="https://github.com/BlissFelix3" target="_blank" rel="noreferrer">
            Bliss Felix ↗
          </a>
        </span>
        <span>RAG + n8n / inspectable by design</span>
      </footer>
      {selected && (
        <Inspector
          selected={selected}
          questionId={question.id}
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
