import { useState } from 'react';
import { startDemo } from './api.js';

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

export function App() {
  const [review, setReview] = useState<ReviewState>({ phase: 'idle' });

  async function start() {
    if (review.phase === 'starting' || review.phase === 'accepted') return;
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
              <button className="start-button" type="button" onClick={() => void start()} disabled={review.phase === 'starting' || review.phase === 'accepted'}>
                <span>{review.phase === 'starting' ? 'Starting review' : review.phase === 'accepted' ? 'Review started' : 'Run evidence review'}</span>
                <span className="button-arrow" aria-hidden="true">↗</span>
              </button>
              <span className="action-note">One request. Three claims. Every answer traceable.</span>
            </div>
            <div className="review-message" role="status">
              {review.phase === 'starting' && <p>Connecting to the assessment workflow…</p>}
              {review.phase === 'accepted' && <p>Review accepted. Run ID: <code>{review.runId}</code></p>}
              {review.phase === 'error' && <p className="error-message">{review.message}</p>}
            </div>
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
