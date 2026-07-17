import { useEffect, useRef, useState } from 'react';
import {
  generatedStageNames,
  type WorkflowSnapshot,
  type WorkflowSnapshotSummary,
} from '../shared/generation.js';
import styles from './App.module.css';

interface WorkflowHistoryDrawerProps {
  projectId: string;
  snapshots: WorkflowSnapshotSummary[];
  onClose(): void;
  onRequestRestore(snapshot: WorkflowSnapshotSummary): void;
  onRequestDelete(snapshot: WorkflowSnapshotSummary): void;
}

export function WorkflowHistoryDrawer({
  projectId,
  snapshots,
  onClose,
  onRequestRestore,
  onRequestDelete,
}: WorkflowHistoryDrawerProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<WorkflowSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  async function inspect(snapshotId: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/workflow-snapshots/${snapshotId}`,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? 'Workflow Snapshot could not be loaded.');
      }
      setSelected(await response.json() as WorkflowSnapshot);
    } catch (inspectionError) {
      setError(inspectionError instanceof Error
        ? inspectionError.message
        : 'Workflow Snapshot could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className={styles['history-drawer']} aria-label="Workflow history">
      <header className={styles['history-heading']}>
        <div>
          <p className={styles.eyebrow}>Project history</p>
          <h2>{selected ? 'Snapshot inspection' : 'Workflow Snapshots'}</h2>
        </div>
        <button
          ref={closeButton}
          className={styles['secondary-action']}
          type="button"
          onClick={onClose}
        >
          Close history
        </button>
      </header>

      {error && <p className={styles['inline-error']} role="alert">{error}</p>}
      {selected ? (
        <div className={styles['snapshot-inspection']}>
          <button
            className={styles['back-link']}
            type="button"
            onClick={() => setSelected(null)}
          >â† All snapshots</button>
          <p>
            Preserved {new Date(selected.createdAt).toLocaleString('en-GB')} before {
              selected.preservedBy === 'restoration'
                ? 'snapshot restoration'
                : `${generatedStageNames[selected.replacedFromStage]} replacement`
            }.
          </p>
          <label className={styles['snapshot-source']}>
            <span>Insight Source</span>
            <textarea
              aria-label="Snapshot Insight Source"
              readOnly
              value={selected.insightSource}
            />
          </label>
          {selected.designBrief && (
            <article aria-label="Design Brief snapshot Artifact" className={styles['snapshot-artifact']}>
              <h3>Design Brief</h3>
              <pre>{selected.designBrief.markdown}</pre>
            </article>
          )}
          {selected.conceptScreenSet && (
            <article aria-label="Concept Screen Set snapshot Artifact" className={styles['snapshot-artifact']}>
              <h3>Concept Screen Set</h3>
              <div className={styles['snapshot-screens']}>
                {selected.conceptScreenSet.screens.map((screen) => (
                  <img
                    key={screen.assetId}
                    src={screen.downloadUrl}
                    alt={`Snapshot Concept Screen ${screen.ordinal}`}
                  />
                ))}
              </div>
            </article>
          )}
          {selected.prd && (
            <article aria-label="PRD snapshot Artifact" className={styles['snapshot-artifact']}>
              <h3>PRD</h3>
              <pre>{selected.prd.markdown}</pre>
            </article>
          )}
          <div className={styles['history-actions']}>
            <button
              className={styles['primary-action']}
              type="button"
              onClick={() => onRequestRestore(selected)}
            >Restore snapshot</button>
            <button
              className={styles['danger-action']}
              type="button"
              onClick={() => onRequestDelete(selected)}
            >Delete snapshot</button>
          </div>
        </div>
      ) : snapshots.length === 0 ? (
        <div className={styles['history-empty']}>
          <strong>No Workflow Snapshots yet</strong>
          <p>A coherent workflow is preserved here whenever generation or restoration replaces it.</p>
        </div>
      ) : (
        <div className={styles['snapshot-list']}>
          {snapshots.map((snapshot) => (
            <article key={snapshot.id} aria-label={`Workflow Snapshot created ${snapshot.createdAt}`}>
              <div>
                <strong>
                  {snapshot.preservedBy === 'restoration'
                    ? 'Preserved before snapshot restoration'
                    : `Preserved before ${generatedStageNames[snapshot.replacedFromStage]} replacement`}
                </strong>
                <time dateTime={snapshot.createdAt}>
                  {new Date(snapshot.createdAt).toLocaleString('en-GB')}
                </time>
              </div>
              <ul>
                {snapshot.stages.map((stage) => (
                  <li key={stage.stageId}>
                    {generatedStageNames[stage.stageId]} Â· {stage.model} Â· {stage.runKind}
                  </li>
                ))}
              </ul>
              <div className={styles['history-actions']}>
                <button
                  className={styles['secondary-action']}
                  type="button"
                  disabled={loading}
                  onClick={() => void inspect(snapshot.id)}
                >{loading ? 'Loadingâ€¦' : 'Inspect snapshot'}</button>
                <button
                  className={styles['primary-action']}
                  type="button"
                  onClick={() => onRequestRestore(snapshot)}
                >Restore snapshot</button>
                <button
                  className={styles['danger-action']}
                  type="button"
                  onClick={() => onRequestDelete(snapshot)}
                >Delete snapshot</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}
