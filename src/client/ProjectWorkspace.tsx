import { useEffect, useRef, useState } from 'react';
import type { Project } from '../shared/projects.js';
import { Modal } from './Modal.js';
import styles from './App.module.css';

interface ProjectWorkspaceProps {
  project: Project;
  onShowLibrary(): void;
  onSaveInsight(insightSource: string): Promise<Project>;
}

type SaveState = 'saved' | 'pending' | 'saving' | 'error';

interface PendingImport {
  name: string;
  text: string;
}

const stages = [
  { number: '01', name: 'Insight Source', state: 'Current' },
  { number: '02', name: 'Design Brief', state: 'Waiting' },
  { number: '03', name: 'Concept Screens', state: 'Waiting' },
  { number: '04', name: 'PRD', state: 'Waiting' },
];

export function ProjectWorkspace({
  project,
  onShowLibrary,
  onSaveInsight,
}: ProjectWorkspaceProps) {
  const [insight, setInsight] = useState(project.insightSource);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const latestProjectId = useRef(project.id);
  const latestInsight = useRef(project.insightSource);
  const savedInsight = useRef(project.insightSource);
  const saveInFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (latestProjectId.current !== project.id) {
      latestProjectId.current = project.id;
      setInsight(project.insightSource);
      latestInsight.current = project.insightSource;
      savedInsight.current = project.insightSource;
      setSaveState('saved');
    }
  }, [project.id, project.insightSource]);

  async function persistLatestInsight(): Promise<void> {
    if (saveInFlight.current) {
      await saveInFlight.current;
      if (latestInsight.current !== savedInsight.current) {
        return persistLatestInsight();
      }
      return;
    }
    const value = latestInsight.current;
    if (value === savedInsight.current) {
      setSaveState('saved');
      return;
    }

    setSaveState('saving');
    const operation = (async () => {
      try {
        await onSaveInsight(value);
        savedInsight.current = value;
        setSaveState(latestInsight.current === value ? 'saved' : 'pending');
      } catch (error) {
        setSaveState('error');
        throw error;
      } finally {
        saveInFlight.current = null;
      }
    })();
    saveInFlight.current = operation;
    return operation;
  }

  async function flushLatestInsight(): Promise<void> {
    while (latestInsight.current !== savedInsight.current) {
      await persistLatestInsight();
    }
  }

  useEffect(() => {
    if (insight === project.insightSource || saveState !== 'pending') {
      return;
    }
    const timer = window.setTimeout(async () => {
      await persistLatestInsight().catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [insight, onSaveInsight, project.insightSource, saveState]);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (latestInsight.current !== savedInsight.current) {
        event.preventDefault();
      }
    }
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  function changeInsight(value: string) {
    setInsight(value);
    latestInsight.current = value;
    setSaveState('pending');
  }

  async function chooseImport(file: File | undefined) {
    setImportError(null);
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name)) {
      setImportError('Choose a UTF-8 .txt or .md file.');
      return;
    }
    try {
      setPendingImport({ name: file.name, text: await file.text() });
    } catch {
      setImportError('That file could not be read.');
    }
  }

  const savePresentation = {
    saved: { label: 'Insight Source saved', visible: 'Saved locally' },
    pending: { label: 'Insight Source has unsaved changes', visible: 'Changes pending' },
    saving: { label: 'Saving Insight Source', visible: 'Saving…' },
    error: { label: 'Insight Source save failed', visible: 'Save failed' },
  }[saveState];

  return (
    <div className={styles['project-workspace']}>
      <aside className={styles['stage-rail']} aria-label="Project stages">
        <a
          className={styles['back-link']}
          href="/"
          onClick={(event) => {
            event.preventDefault();
            void (async () => {
              try {
                await flushLatestInsight();
                onShowLibrary();
              } catch {
                // The visible save error keeps the Author in the workspace.
              }
            })();
          }}
        >
          <span aria-hidden="true">←</span> All projects
        </a>
        <ol>
          {stages.map((stage) => (
            <li className={stage.number === '01' ? styles['stage-rail-active'] : ''} key={stage.number}>
              <span className={styles['rail-number']}>{stage.number}</span>
              <div>
                <strong>{stage.name}</strong>
                <span>{stage.state}</span>
              </div>
            </li>
          ))}
        </ol>
        <div className={styles['local-note']}>
          <span className={styles['local-note-icon']} aria-hidden="true">⌂</span>
          <div>
            <strong>Continuously saved</strong>
            <span>Your Project lives on this device</span>
          </div>
        </div>
      </aside>

      <main className={styles['artifact-canvas']}>
        <header className={styles['project-heading']}>
          <div>
            <p className={styles.eyebrow}>Stage 01 · Insight Source</p>
            <h1>{project.name}</h1>
          </div>
          <span
            className={`${styles['save-state']} ${styles[`save-state--${saveState}`]}`}
            role="status"
            aria-label={savePresentation.label}
          >
            <span aria-hidden="true" /> {savePresentation.visible}
          </span>
        </header>

        <section className={styles['insight-editor']} aria-labelledby="insight-title">
          <div className={styles['editor-heading']}>
            <div>
              <h2 id="insight-title">What signal is worth pursuing?</h2>
              <p>Write the raw observation, problem, or opportunity. This is the source for the entire workflow.</p>
            </div>
            <label className={styles['import-action']}>
              <span aria-hidden="true">↑</span> Import .txt or .md
              <input
                className={styles['visually-hidden']}
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                aria-label="Import Insight Source file"
                onChange={(event) => {
                  void chooseImport(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
          <label className={styles['editor-label']}>
            <span className={styles['visually-hidden']}>Insight Source</span>
            <textarea
              value={insight}
              aria-label="Insight Source"
              placeholder="Start with the observation that changed how you see the problem…"
              onChange={(event) => changeInsight(event.target.value)}
              onBlur={() => void persistLatestInsight().catch(() => undefined)}
            />
          </label>
          <footer className={styles['editor-footer']}>
            <span>{insight.length.toLocaleString('en-GB')} characters</span>
            <span>Plain text · autosaves after you pause</span>
          </footer>
          {importError && <p className={styles['inline-error']} role="alert">{importError}</p>}
        </section>

        <aside className={styles['iteration-note']}>
          <span className={styles['iteration-mark']} aria-hidden="true">01</span>
          <div>
            <strong>The source stays editable until generation begins.</strong>
            <p>Later workflow stages will be read-only outcomes. You improve them by refining their prompt and running the chain again.</p>
          </div>
        </aside>
      </main>

      {pendingImport && (
        <Modal
          title="Replace Insight Source?"
          onDismiss={() => setPendingImport(null)}
          actions={(
            <>
              <button className={styles['secondary-action']} type="button" onClick={() => setPendingImport(null)}>Cancel</button>
              <button
                className={styles['primary-action']}
                type="button"
                onClick={() => {
                  changeInsight(pendingImport.text);
                  setPendingImport(null);
                }}
              >Replace insight</button>
            </>
          )}
        >
          <p>
            Importing <strong>{pendingImport.name}</strong> will replace the text currently in this Project. The imported file itself will not be stored.
          </p>
        </Modal>
      )}
    </div>
  );
}
