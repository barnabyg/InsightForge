import type { ConceptScreenRun } from '../shared/generation.js';
import styles from './App.module.css';

interface ConceptScreenRunInspectorProps {
  run: ConceptScreenRun | null;
  generating: boolean;
  elapsedSeconds: number;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return 'In progress';
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function statusLabel(status: ConceptScreenRun['status']): string {
  if (status === 'succeeded') return 'Succeeded';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'failed') return 'Failed';
  return 'Running';
}

export function ConceptScreenRunInspector({
  run,
  generating,
  elapsedSeconds,
}: ConceptScreenRunInspectorProps) {
  const nextOrdinal = Math.min(3, (run?.completedOperationCount ?? 0) + 1);
  return (
    <aside className={styles['run-inspector']} aria-label="Run Inspector">
      <div className={styles['inspector-heading']}>
        <p className={styles.eyebrow}>Diagnostics</p>
        <h2>Run Inspector</h2>
      </div>

      {generating && (
        <div className={styles['run-progress']} role="status" aria-label="Generating Concept Screens">
          <span className={styles['progress-spinner']} aria-hidden="true" />
          <strong>Generating Concept Screens</strong>
          <span>Screen {nextOrdinal} of 3 · {elapsedSeconds}s elapsed</span>
        </div>
      )}

      {run ? (
        <>
          <div className={`${styles['run-status']} ${styles[`run-status--${run.status}`]}`}>
            <span aria-hidden="true" /> {statusLabel(run.status)}
          </div>
          <dl className={styles['inspector-facts']}>
            <div><dt>Model</dt><dd>{run.model}</dd></div>
            <div><dt>Quality</dt><dd>{run.imageQuality[0].toUpperCase() + run.imageQuality.slice(1)}</dd></div>
            <div><dt>Progress</dt><dd>{run.completedOperationCount} of 3 PNGs</dd></div>
            <div><dt>Duration</dt><dd>{formatDuration(run.durationMs)}</dd></div>
            {run.validation && (
              <div><dt>Validation</dt><dd>{run.validation.width} × {run.validation.height} · {run.validation.status === 'valid' ? 'Valid' : 'Warning'}</dd></div>
            )}
          </dl>

          <section className={styles['inspector-section']} aria-label="Image operations">
            <h3>Image operations</h3>
            <ol className={styles['operation-list']}>
              {run.operations.map((operation) => (
                <li key={operation.ordinal}>
                  <div><strong>Screen {operation.ordinal}</strong><span>{statusLabel(operation.status)}</span></div>
                  <small>{operation.width && operation.height ? `${operation.width} × ${operation.height}` : formatDuration(operation.durationMs)}</small>
                  {operation.requestId && <code>{operation.requestId}</code>}
                </li>
              ))}
            </ol>
          </section>

          {run.usage && (
            <section className={styles['inspector-section']} aria-label="Token usage">
              <h3>Usage</h3>
              <dl className={styles['usage-grid']}>
                <div><dt>Input tokens</dt><dd>{run.usage.inputTokens}</dd></div>
                <div><dt>Output tokens</dt><dd>{run.usage.outputTokens}</dd></div>
                <div><dt>Total</dt><dd>{run.usage.totalTokens}</dd></div>
              </dl>
            </section>
          )}

          {run.validation?.warnings.map((warning) => (
            <div className={styles['sanity-warning']} key={warning.code}>
              <strong>Sanity Warning</strong><span>{warning.message}</span>
            </div>
          ))}
          {run.error && (
            <div className={styles['run-error']} role="alert">
              <strong>{run.error.code}</strong><span>{run.error.message}</span>
            </div>
          )}
          <details className={styles['inspector-details']}>
            <summary>Assembled request</summary><pre>{run.assembledRequest}</pre>
          </details>
          <details className={styles['inspector-details']}>
            <summary>Prompt snapshot</summary><pre>{run.stagePrompt}</pre>
          </details>
        </>
      ) : !generating ? (
        <p className={styles['inspector-empty']}>Image progress, validation, usage, and request IDs will appear here after generation.</p>
      ) : null}
    </aside>
  );
}
