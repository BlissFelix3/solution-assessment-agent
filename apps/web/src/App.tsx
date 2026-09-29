import { useEffect, useState } from 'react';
import { getRunProgress, startDemo, type RunProgress } from './api.js';

const requirements = [
  'Let employees sign in with SAML 2.0.',
  'Send account events to our HTTPS webhook.',
  'Make the first delivery attempt within 60 seconds.',
];

type ReviewState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'accepted'; runId: string }
  | { phase: 'error'; message: string };

function describeProgress(progress: RunProgress | null): string {
  if (!progress) return 'Checking saved assessments…';
  const count = `${progress.assessmentCount} of 3 requirements assessed.`;
  switch (progress.status) {
    case 'pending': return `${count} The review is running.`;
    case 'completed': return `Review complete. ${count}`;
    case 'failed': return `The review failed. ${count} You can start another review.`;
    case 'timed_out': return `No final outcome after ten minutes. ${count} The status may still change.`;
  }
}

export function App() {
  const [review, setReview] = useState<ReviewState>({ phase: 'idle' });
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const runId = review.phase === 'accepted' ? review.runId : null;

  useEffect(() => {
    if (!runId) return;
    const id = runId;
    const controller = new AbortController();
    let active = true;
    let timer: number | undefined;

    async function read() {
      setChecking(true);
      try {
        const next = await getRunProgress(id, controller.signal);
        if (!active) return;
        setProgress(next);
        setProgressError(null);
        if (next.status === 'pending') {
          timer = window.setTimeout(() => void read(), 2_000);
        }
      } catch {
        if (active) setProgressError('Could not refresh the review status.');
      } finally {
        if (active) setChecking(false);
      }
    }

    void read();
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [runId, refreshCount]);

  const startDisabled = review.phase === 'starting' ||
    (review.phase === 'accepted' && progress?.status !== 'failed');

  async function start() {
    if (startDisabled) return;
    setProgress(null);
    setProgressError(null);
    setReview({ phase: 'starting' });
    try {
      const runId = await startDemo();
      setReview({ phase: 'accepted', runId });
    } catch (error) {
      setReview({
        phase: 'error',
        message: error instanceof Error ? error.message : 'We could not confirm whether the review started.',
      });
    }
  }

  const startLabel = review.phase === 'starting' ? 'Starting review' :
    review.phase === 'accepted' && progress?.status === 'failed' ? 'Run another review' :
    review.phase === 'accepted' ? 'Review started' : 'Run evidence review';

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">S<span className="brand-star">✳</span></span>
          <span className="brand-name">SOLUTION REVIEW<span> / EVIDENCE DESK</span></span>
        </div>
        <div className="header-index"><span className="index-dot" /><span>LIVE DEMONSTRATION</span><span className="header-divider" /><span className="project-index">PROJECT 02</span></div>
      </header>

      <main>
        <section className="intro-grid" aria-labelledby="page-title">
          <div className="intro-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> THE ASSESSMENT DESK <span className="eyebrow-number">/ 001</span></p>
            <h1 id="page-title">A confident answer needs <em>evidence.</em></h1>
            <p className="lead">A customer asks what the platform can deliver. This review checks each requirement against versioned product documents, then builds a path from what the evidence actually supports.</p>
            <div className="action-block">
              <button className="start-button" type="button" onClick={() => void start()} disabled={startDisabled}>
                <span>{startLabel}</span>
                <span className="button-arrow" aria-hidden="true">↗</span>
              </button>
              <span className="action-note">One request. Three claims. Every answer traceable.</span>
            </div>
            {(review.phase === 'starting' || review.phase === 'error') && (
              <div className="review-message" role="status">
                {review.phase === 'starting' && <p>Connecting to the assessment workflow…</p>}
                {review.phase === 'error' && <p className="error-message">{review.message}</p>}
              </div>
            )}
            {runId && (
              <section className="run-progress" aria-label="Review progress" data-status={progress?.status ?? 'checking'}>
                <div className="run-progress-heading"><span>ASSESSMENT STATUS</span><span>{progress?.status.replace('_', ' ').toUpperCase() ?? 'CHECKING'}</span></div>
                <div className="progress-count"><strong>{progress?.assessmentCount ?? '—'}</strong><span>/ 3 REQUIREMENTS</span></div>
                <div className="progress-track" role="progressbar" aria-label="Requirements assessed" aria-valuenow={progress?.assessmentCount ?? 0} aria-valuemin={0} aria-valuemax={3}>
                  <span style={{ width: `${((progress?.assessmentCount ?? 0) / 3) * 100}%` }} />
                </div>
                <p className="progress-description" role="status">{progressError ?? describeProgress(progress)}</p>
                {(progressError || progress?.status === 'timed_out') && (
                  <button className="refresh-button" type="button" disabled={checking} onClick={() => setRefreshCount((count) => count + 1)}>
                    {checking ? 'Checking status…' : 'Check status again'}
                  </button>
                )}
                <p className="run-identity">RUN ID <code>{runId}</code></p>
              </section>
            )}
          </div>

          <aside className="request-panel" aria-labelledby="request-title">
            <div className="panel-topline"><span>INCOMING REQUEST</span><span>NS — 001</span></div>
            <div className="panel-heading"><span className="panel-kicker">CUSTOMER BRIEF</span><h2 id="request-title">Northstar integration</h2></div>
            <p className="panel-summary">A proposed product integration needs clear answers on identity, event delivery, and timing.</p>
            <ol className="requirement-list">
              {requirements.map((requirement, index) => (
                <li key={requirement}><span className="requirement-number">0{index + 1}</span><span>{requirement}</span></li>
              ))}
            </ol>
            <div className="panel-footer"><span className="small-star" aria-hidden="true">✳</span><span>Claims are assessed against a pinned source revision.</span></div>
          </aside>
        </section>

        <section className="method-strip" aria-label="Review method">
          <div className="method-heading"><span className="eyebrow">THE METHOD</span><p>From request to defensible decision.</p></div>
          <div className="method-step"><span>01 / RETRIEVE</span><p>Find relevant passages in product documentation.</p></div>
          <div className="method-step"><span>02 / ASSESS</span><p>Classify each claim and show what the documents prove.</p></div>
          <div className="method-step"><span>03 / PLAN</span><p>Set the next action without inventing a commitment.</p></div>
        </section>
      </main>

      <footer className="site-footer"><span>ENTERPRISE SOLUTION ASSESSMENT AGENT</span><span>DOCUMENTED CLAIMS / VISIBLE UNCERTAINTY</span></footer>
    </div>
  );
}
