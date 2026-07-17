import type { DesignBriefRun, PrdRun } from '../shared/generation.js';
import styles from './App.module.css';

interface RunInspectorProps {
  run: DesignBriefRun | PrdRun | null;
  generating: boolean;
  elapsedSeconds: number;
  stageName: 'Design Brief' | 'PRD';
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return 'In progress';
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

export function RunInspector({ run, generating, elapsedSeconds, stageName }: RunInspectorProps) {
  return (
    <aside className={styles['run-inspector']} aria-label="Run Inspector">
      <div className={styles['inspector-heading']}>
        <p className={styles.eyebrow}>Diagnostics</p>
        <h2>Run Inspector</h2>
      </div>

      {generating ? (
        <div className={styles['run-progress']} role="status" aria-label={`Generating ${stageName}`}>
          <span className={styles['progress-spinner']} aria-hidden="true" />
          <strong>Generating {stageName}</strong>
          <span>{elapsedSeconds}s elapsed · one OpenAI text request</span>
        </div>
      ) : run ? (
        <>
          <div className={`${styles['run-status']} ${styles[`run-status--${run.status}`]}`}>
            <span aria-hidden="true" />
            {run.status === 'succeeded' ? 'Succeeded' : run.status === 'failed' ? 'Failed' : 'Running'}
          </div>

          <dl className={styles['inspector-facts']}>
            <div><dt>Model</dt><dd>{run.model}</dd></div>
            <div><dt>Duration</dt><dd>{formatDuration(run.durationMs)}</dd></div>
            <div><dt>Started</dt><dd><time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString('en-GB')}</time></dd></div>
            {run.stageId === 'prd' && (
              <>
                <div><dt>Design Brief input</dt><dd><code>{run.stageInput.designBrief.artifactId}</code></dd></div>
                <div><dt>Visual inputs</dt><dd>{run.stageInput.conceptScreenSet.screens.length} Concept Screens</dd></div>
                <div><dt>Concept Screen Set</dt><dd><code>{run.stageInput.conceptScreenSet.artifactId}</code></dd></div>
              </>
            )}
            {run.validation && (
              <div><dt>Validation</dt><dd>{run.validation.wordCount} words · {run.validation.status === 'valid' ? 'Valid' : 'Warning'}</dd></div>
            )}
          </dl>

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
              <strong>Sanity Warning</strong>
              <span>{warning.message}</span>
            </div>
          ))}

          {run.error && (
            <div className={styles['run-error']} role="alert">
              <strong>{run.error.code}</strong>
              <span>{run.error.message}</span>
            </div>
          )}

          <details className={styles['inspector-details']}>
            <summary>Assembled request</summary>
            <pre>{run.assembledRequest}</pre>
          </details>
          <details className={styles['inspector-details']}>
            <summary>Prompt snapshot</summary>
            <pre>{run.stagePrompt}</pre>
          </details>
          <div className={styles['request-identifiers']}>
            <span>Request ID</span>
            <code>{run.requestId ?? 'Not reported'}</code>
            <span>Response ID</span>
            <code>{run.responseId ?? 'Not reported'}</code>
          </div>
        </>
      ) : (
        <p className={styles['inspector-empty']}>
          Run details, validation, and usage will appear here after generation.
        </p>
      )}
    </aside>
  );
}
