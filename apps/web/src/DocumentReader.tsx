import { useEffect, useState } from 'react';
import { getSource, type SourceDocument } from './api.js';
import type { Execution } from './ExecutionInspector.js';

const files = import.meta.glob<string>('../../../fixtures/sources/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const documents = Object.entries(files).map(([file, content]) => ({
  path: file.split('/').at(-1) ?? file,
  title: content.split('\n')[0].replace(/^# /, ''),
  content,
}));

export function DocumentReader({ execution }: { execution: Execution | null }) {
  const [path, setPath] = useState('webhooks.md');
  const [pinned, setPinned] = useState<SourceDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const document = documents.find((item) => item.path === path);
  useEffect(() => {
    const controller = new AbortController();
    setPinned(null);
    setError(null);
    if (execution?.mode === 'live') {
      void getSource(execution.trace.runId, path, controller.signal)
        .then((source) => {
          if (controller.signal.aborted) return;
          if (source.sourceRevisionId !== execution.trace.sourceRevisionId) {
            setError('This document does not belong to the run’s source revision.');
          } else setPinned(source);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : 'Could not open this document.');
        });
    }
    return () => controller.abort();
  }, [execution?.mode, execution?.trace.runId, execution?.trace.sourceRevisionId, path]);
  const live = execution?.mode === 'live';
  const content = live
    ? pinned?.path === path && pinned.sourceRevisionId === execution.trace.sourceRevisionId
      ? pinned.content
      : undefined
    : document?.content;
  return (
    <aside className="document-pane" aria-labelledby="documents-heading">
      <div className="document-library">
        <header className="library-heading">
          <h2 id="documents-heading">Knowledge base</h2>
          <span>{documents.length}</span>
        </header>
        <div className="library-collection">
          <span aria-hidden="true">▱</span> Product documentation
        </div>
        <nav className="document-list" aria-label="Source documents">
          {documents.map((item) => (
            <button
              key={item.path}
              aria-pressed={path === item.path}
              onClick={() => setPath(item.path)}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M5 2h7l3 3v13H5zM12 2v4h3M8 10h4M8 13h4" />
              </svg>
              <span>{item.title}</span>
            </button>
          ))}
        </nav>
        <div className="library-note">
          <span className="section-kicker">DEMO CORPUS</span>
          <p>Fictional product. Real source documents.</p>
          <span>Read any document, then ask a question.</span>
        </div>
      </div>
      <div className="document-reader">
        <header className="reader-toolbar">
          <span>
            Documentation <span aria-hidden="true">/</span> <strong>{path}</strong>
          </span>
          <span className="reader-format">MD</span>
        </header>
        <div className="reader-body">
          <div className="document-label">
            <span className="source-tag">SOURCE DOCUMENT</span>
            <span>{live ? 'Pinned to this run' : 'Full document'}</span>
          </div>
          <article className="document-paper" aria-live="polite">
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            {!content && !error && <p role="status">Loading source document…</p>}
            {content
              ?.trim()
              .split('\n\n')
              .map((paragraph, i) =>
                paragraph.startsWith('# ') ? (
                  <h3 key={i}>{paragraph.slice(2)}</h3>
                ) : (
                  <p key={i}>{paragraph}</p>
                ),
              )}
            {content && (
              <footer>
                <span>▤ {path}</span>
                <span>
                  End of document <span aria-hidden="true">✓</span>
                </span>
              </footer>
            )}
          </article>
          <div className="document-context">
            <span aria-hidden="true">↳</span>
            <p>
              <strong>From source to answer</strong>Assessments cite exact passages from the
              documents. Open a citation to check the full source.
            </p>
          </div>
        </div>
        <footer className="reader-footer">
          <span>Read-only source</span>
          <span>{live ? 'Run source revision' : 'Checked-in demo corpus'}</span>
        </footer>
      </div>
    </aside>
  );
}
