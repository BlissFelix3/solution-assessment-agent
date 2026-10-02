import { useEffect, useState } from 'react';
import type { SourceDocument } from '../../../../domain/assessment.js';
import type { AssessmentApi } from '../../../../application/ports/assessment-api.js';
import type { Execution } from '../../../../domain/execution.js';

const files = import.meta.glob<string>('../../../../../../../fixtures/sources/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const documents = Object.entries(files).map(([file, content]) => ({
  path: file.split('/').at(-1) ?? file,
  title: content.split('\n')[0].replace(/^# /, ''),
  content,
}));

export function DocumentReader({ api, execution, hidden }: {
  api: AssessmentApi;
  execution: Execution | null;
  hidden: boolean;
}) {
  const [path, setPath] = useState('webhooks.md');
  const [pinned, setPinned] = useState<SourceDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const document = documents.find((item) => item.path === path);
  useEffect(() => {
    const controller = new AbortController();
    setPinned(null);
    setError(null);
    if (execution?.mode === 'live') {
      void api.getSource(execution.trace.runId, path, controller.signal)
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
  }, [api, execution?.mode, execution?.trace.runId, execution?.trace.sourceRevisionId, path]);
  const live = execution?.mode === 'live';
  const content = live
    ? pinned?.path === path && pinned.sourceRevisionId === execution.trace.sourceRevisionId
      ? pinned.content
      : undefined
    : document?.content;
  return (
    <aside className="document-pane" aria-labelledby="documents-heading" hidden={hidden}>
      <div className="document-library">
        <header className="library-heading">
          <h2 id="documents-heading">Product documents</h2>
          <span>{documents.length} documents</span>
        </header>
        <nav className="document-list" aria-label="Source documents">
          {documents.map((item) => (
            <button
              key={item.path}
              aria-pressed={path === item.path}
              onClick={() => setPath(item.path)}
            >
              <span>{item.title}</span>
            </button>
          ))}
        </nav>
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
            <span className="source-tag">PRODUCT DOCUMENTATION</span>
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
