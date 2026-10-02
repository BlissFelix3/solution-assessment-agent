import type { Execution, SourceSelection } from './ExecutionInspector.js';
import { Status } from './Status.js';

export function AssessmentResults({
  execution,
  questionId,
  onQuestion,
  onSource,
}: {
  execution: Execution;
  questionId: string;
  onQuestion: (id: string) => void;
  onSource: (selection: SourceSelection) => void;
}) {
  const pending =
    execution.mode === 'live' &&
    (execution.trace.status === 'pending' || execution.progress.status === 'pending');
  const submitted = execution.trace.requirements;
  const question = submitted.find((item) => item.id === questionId) ?? submitted[0];
  if (!question) return null;
  const assessment = execution.progress.assessments.find((item) => item.questionId === question.id);
  return (
    <section className="results" aria-labelledby="results-heading">
      <div className="form-heading">
        <h2 id="results-heading">
          {execution.mode === 'recorded' ? 'Example answer' : 'Your answer'}
        </h2>
        <Status value={execution.progress.status} />
      </div>
      {execution.mode === 'recorded' && (
        <p className="recording-notice">
          A previously completed run with its original questions and evidence. This is a recorded
          example.
        </p>
      )}
      {submitted.length > 1 && (
        <div className="result-tabs" aria-label="Submitted questions">
          {submitted.map((item, index) => {
            const saved = execution.progress.assessments.find(
              (result) => result.questionId === item.id,
            );
            return (
              <button
                key={item.id}
                aria-pressed={item.id === question.id}
                onClick={() => {
                  onQuestion(item.id);
                }}
              >
                <span className="result-dot" data-verdict={saved?.verdict ?? 'waiting'} />
                Question {index + 1}
                <span className="tab-verdict">{saved?.verdict ?? 'waiting'}</span>
              </button>
            );
          })}
        </div>
      )}
      <h3 className="assessed-question">{question.question}</h3>
      {assessment ? (
        <div className="answer">
          <Status value={assessment.verdict} />
          <p className="answer-explanation">{assessment.explanation}</p>
          {assessment.basis.map((quote, index) => (
            <blockquote key={`${quote.path}-${index}`}>
              <p>“{quote.quote}”</p>
              <button onClick={() => onSource(quote)}>{quote.path} ↗</button>
            </blockquote>
          ))}
          {assessment.missingEvidence && (
            <div className="evidence-needed">
              <strong>Evidence still needed</strong>
              <p>{assessment.missingEvidence}</p>
            </div>
          )}
          {assessment.notProof.map((quote, index) => (
            <details className="not-proof" key={`${quote.path}-${index}`}>
              <summary>Relevant evidence that does not prove the claim</summary>
              <p>“{quote.quote}”</p>
              <p>{quote.reason}</p>
              <button onClick={() => onSource(quote)}>{quote.path} ↗</button>
            </details>
          ))}
        </div>
      ) : (
        <div className="answer-pending">
          <span aria-hidden="true">{pending ? '◌' : '—'}</span>
          <p>
            {execution.progress.status === 'failed'
              ? 'No saved answer for this requirement. The execution panel shows where the run stopped.'
              : execution.mode === 'recorded'
                ? 'This answer has not been saved at this point in the replay.'
                : 'Waiting for a validated answer from the workflow.'}
          </p>
        </div>
      )}
      {execution.progress.implementationPath && (
        <details className="implementation-path">
          <summary>
            Implementation path{' '}
            <span>
              {execution.progress.implementationPath.length}{' '}
              {execution.progress.implementationPath.length === 1 ? 'step' : 'steps'}
            </span>
          </summary>
          {execution.progress.implementationPath.map((step, index) => (
            <article key={step.questionId}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <Status value={step.readiness} />
                <p>{step.action}</p>
              </div>
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
