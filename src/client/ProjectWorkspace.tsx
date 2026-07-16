import { useEffect, useRef, useState } from 'react';
import type { Project } from '../shared/projects.js';
import { MarkdownArtifact } from './MarkdownArtifact.js';
import { ConceptScreenGallery } from './ConceptScreenGallery.js';
import { ConceptScreenRunInspector } from './ConceptScreenRunInspector.js';
import { Modal } from './Modal.js';
import { RunInspector } from './RunInspector.js';
import { useProjectWorkflow } from './useProjectWorkflow.js';
import styles from './App.module.css';

interface ProjectWorkspaceProps {
  project: Project;
  onShowLibrary(): void;
  onSaveInsight(insightSource: string): Promise<Project>;
}

type SaveState = 'saved' | 'pending' | 'saving' | 'error';
type SelectedStage = 'insight_source' | 'design_brief' | 'concept_screens';

interface PendingImport {
  name: string;
  text: string;
}

export function ProjectWorkspace({
  project,
  onShowLibrary,
  onSaveInsight,
}: ProjectWorkspaceProps) {
  const [selectedStage, setSelectedStage] = useState<SelectedStage>('insight_source');
  const [insight, setInsight] = useState(project.insightSource);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const workflow = useProjectWorkflow(project.id);
  const latestProjectId = useRef(project.id);
  const latestInsight = useRef(project.insightSource);
  const savedInsight = useRef(project.insightSource);
  const saveInFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (latestProjectId.current !== project.id) {
      latestProjectId.current = project.id;
      setSelectedStage('insight_source');
      setInsight(project.insightSource);
      latestInsight.current = project.insightSource;
      savedInsight.current = project.insightSource;
      setSaveState('saved');
    }
  }, [project.id, project.insightSource]);

  useEffect(() => {
    if (!workflow.generating) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [workflow.generating]);

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
    if (insight === project.insightSource || saveState !== 'pending') return;
    const timer = window.setTimeout(async () => {
      await persistLatestInsight().catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [insight, onSaveInsight, project.insightSource, saveState]);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (latestInsight.current !== savedInsight.current) event.preventDefault();
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

  async function selectStage(stage: SelectedStage) {
    if (stage !== 'insight_source') {
      try {
        await flushLatestInsight();
        await workflow.refresh();
      } catch {
        return;
      }
    }
    setSelectedStage(stage);
  }

  const savePresentation = {
    saved: { label: 'Insight Source saved', visible: 'Saved locally' },
    pending: { label: 'Insight Source has unsaved changes', visible: 'Changes pending' },
    saving: { label: 'Saving Insight Source', visible: 'Saving…' },
    error: { label: 'Insight Source save failed', visible: 'Save failed' },
  }[saveState];
  const designBriefState = workflow.generating
    ? 'Generating'
    : workflow.workflow?.designBrief
      ? 'Current'
      : insight.trim()
        ? 'Ready'
        : 'Waiting';
  const conceptScreenState = workflow.generatingStage === 'concept_screens'
    ? 'Generating'
    : workflow.workflow?.conceptScreenSet
      ? 'Current'
      : workflow.workflow?.designBrief
        ? 'Ready'
        : 'Waiting';
  const insightLocked = Boolean(workflow.workflow?.designBrief);

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
          <li className={selectedStage === 'insight_source' ? styles['stage-rail-active'] : ''}>
            <button type="button" onClick={() => void selectStage('insight_source')}>
              <span className={styles['rail-number']}>01</span>
              <span><strong>Insight Source</strong><small>Current</small></span>
            </button>
          </li>
          <li className={selectedStage === 'design_brief' ? styles['stage-rail-active'] : ''}>
            <button type="button" onClick={() => void selectStage('design_brief')}>
              <span className={styles['rail-number']}>02</span>
              <span><strong>Design Brief</strong><small>{designBriefState}</small></span>
            </button>
          </li>
          <li className={selectedStage === 'concept_screens' ? styles['stage-rail-active'] : ''}>
            <button type="button" onClick={() => void selectStage('concept_screens')}>
              <span className={styles['rail-number']}>03</span>
              <span><strong>Concept Screens</strong><small>{conceptScreenState}</small></span>
            </button>
          </li>
          <li>
            <button type="button" disabled>
              <span className={styles['rail-number']}>04</span>
              <span><strong>PRD</strong><small>Waiting</small></span>
            </button>
          </li>
        </ol>
        <div className={styles['local-note']}>
          <span className={styles['local-note-icon']} aria-hidden="true">⌂</span>
          <div><strong>Continuously saved</strong><span>Your Project lives on this device</span></div>
        </div>
      </aside>

      {selectedStage === 'insight_source' ? (
        <main className={styles['artifact-canvas']}>
          <header className={styles['project-heading']}>
            <div><p className={styles.eyebrow}>Stage 01 · Insight Source</p><h1>{project.name}</h1></div>
            <span
              className={`${styles['save-state']} ${styles[`save-state--${saveState}`]}`}
              role="status"
              aria-label={savePresentation.label}
            ><span aria-hidden="true" /> {savePresentation.visible}</span>
          </header>

          <section className={styles['insight-editor']} aria-labelledby="insight-title">
            <div className={styles['editor-heading']}>
              <div>
                <h2 id="insight-title">What signal is worth pursuing?</h2>
                <p>Write the raw observation, problem, or opportunity. This is the source for the entire workflow.</p>
              </div>
              <label className={`${styles['import-action']} ${insightLocked ? styles['import-action--disabled'] : ''}`}>
                <span aria-hidden="true">↑</span> Import .txt or .md
                <input
                  className={styles['visually-hidden']}
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  aria-label="Import Insight Source file"
                  disabled={insightLocked}
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
                readOnly={insightLocked}
                aria-describedby={insightLocked ? 'insight-lock-message' : undefined}
                placeholder="Start with the observation that changed how you see the problem…"
                onChange={(event) => changeInsight(event.target.value)}
                onBlur={() => void persistLatestInsight().catch(() => undefined)}
              />
            </label>
            <footer className={styles['editor-footer']}>
              <span>{insight.length.toLocaleString('en-GB')} characters</span>
              <span>Plain text · autosaves after you pause</span>
            </footer>
            {insightLocked && (
              <p className={styles['insight-lock-message']} id="insight-lock-message">
                Insight Source is locked after generation to keep the current workflow consistent.
              </p>
            )}
            {importError && <p className={styles['inline-error']} role="alert">{importError}</p>}
          </section>

          <aside className={styles['iteration-note']}>
            <span className={styles['iteration-mark']} aria-hidden="true">01</span>
            <div>
              <strong>The source stays editable until generation begins.</strong>
              <p>Later workflow stages are read-only outcomes. Improve them by refining their prompt and running the chain again.</p>
            </div>
          </aside>
        </main>
      ) : selectedStage === 'design_brief' ? (
        <main className={`${styles['artifact-canvas']} ${styles['design-brief-canvas']}`}>
          <header className={styles['project-heading']}>
            <div>
              <p className={styles.eyebrow}>Stage 02 · {project.name}</p>
              <h1>Design Brief</h1>
            </div>
            {workflow.workflow?.designBrief && (
              <span className={styles['artifact-date']}>
                Generated <time dateTime={workflow.workflow.designBrief.createdAt}>
                  {new Date(workflow.workflow.designBrief.createdAt).toLocaleString('en-GB')}
                </time>
              </span>
            )}
          </header>

          {workflow.error && (
            <div className={styles['workspace-error']} role="alert">
              <span>{workflow.error}</span>
              <button type="button" onClick={workflow.clearError}>Dismiss</button>
            </div>
          )}

          <div className={styles['design-brief-layout']}>
            <div className={styles['design-brief-main']}>
              <section className={styles['stage-action-card']} aria-label="Design Brief generation">
                <div>
                  <p className={styles.eyebrow}>Shared Stage Configuration</p>
                  <strong>{workflow.workflow?.designBriefConfiguration.model ?? 'Loading model…'}</strong>
                  <span>Uses the active Design Brief prompt and protected Insight Source input.</span>
                </div>
                <a href="/?view=prompts">Edit shared prompt</a>
                <button
                  className={styles['primary-action']}
                  type="button"
                  disabled={workflow.loading || workflow.generating || !workflow.workflow?.canGenerateDesignBrief}
                  onClick={() => void workflow.generateDesignBrief().catch(() => undefined)}
                >
                  {workflow.generating
                    ? 'Generating…'
                    : workflow.workflow?.designBrief
                      ? 'Generate another variation'
                      : 'Generate Design Brief'}
                </button>
              </section>

              {workflow.workflow?.generationBlocker && (
                <p className={styles['generation-blocker']}>{workflow.workflow.generationBlocker}</p>
              )}

              {workflow.workflow?.designBrief ? (
                <MarkdownArtifact artifact={workflow.workflow.designBrief} projectName={project.name} />
              ) : (
                <section className={styles['artifact-empty']}>
                  <span aria-hidden="true">02</span>
                  <h2>Turn the signal into product direction</h2>
                  <p>The Design Brief will appear here as a read-only Markdown Artifact after one structured text request.</p>
                </section>
              )}
            </div>

            <RunInspector
              run={workflow.workflow?.lastDesignBriefRun ?? null}
              generating={workflow.generating}
              elapsedSeconds={elapsedSeconds}
            />
          </div>
        </main>
      ) : (
        <main className={`${styles['artifact-canvas']} ${styles['design-brief-canvas']}`}>
          <header className={styles['project-heading']}>
            <div>
              <p className={styles.eyebrow}>Stage 03 · {project.name}</p>
              <h1>Concept Screens</h1>
            </div>
            {workflow.workflow?.conceptScreenSet && (
              <span className={styles['artifact-date']}>
                Generated <time dateTime={workflow.workflow.conceptScreenSet.createdAt}>
                  {new Date(workflow.workflow.conceptScreenSet.createdAt).toLocaleString('en-GB')}
                </time>
              </span>
            )}
          </header>

          {workflow.error && (
            <div className={styles['workspace-error']} role="alert">
              <span>{workflow.error}</span>
              <button type="button" onClick={workflow.clearError}>Dismiss</button>
            </div>
          )}

          <div className={styles['design-brief-layout']}>
            <div className={styles['design-brief-main']}>
              <section className={styles['stage-action-card']} aria-label="Concept Screen generation">
                <div>
                  <p className={styles.eyebrow}>Shared Stage Configuration</p>
                  <strong>{workflow.workflow?.conceptScreenConfiguration.model ?? 'Loading model…'}</strong>
                  <span>
                    {workflow.workflow?.conceptScreenConfiguration.imageQuality ?? '—'} quality · three sequential PNG operations using the protected Design Brief.
                  </span>
                </div>
                <a href="/?view=prompts">Edit shared prompt</a>
                {workflow.generatingStage === 'concept_screens' ? (
                  <button
                    className={styles['secondary-action']}
                    type="button"
                    disabled={workflow.cancelling}
                    onClick={() => void workflow.cancelConceptScreens().catch(() => undefined)}
                  >{workflow.cancelling ? 'Cancelling…' : 'Cancel after current screen'}</button>
                ) : (
                  <button
                    className={styles['primary-action']}
                    type="button"
                    disabled={workflow.loading || workflow.generating || !workflow.workflow?.canGenerateConceptScreens}
                    onClick={() => void workflow.generateConceptScreens().catch(() => undefined)}
                  >
                    {workflow.workflow?.lastConceptScreenRun
                      && workflow.workflow.lastConceptScreenRun.status !== 'succeeded'
                      && workflow.workflow.lastConceptScreenRun.completedOperationCount < 3
                      ? `Resume from Screen ${workflow.workflow.lastConceptScreenRun.completedOperationCount + 1}`
                      : workflow.workflow?.conceptScreenSet
                        ? 'Generate another variation'
                        : 'Generate Concept Screens'}
                  </button>
                )}
              </section>

              {workflow.workflow?.conceptScreenGenerationBlocker && (
                <p className={styles['generation-blocker']}>{workflow.workflow.conceptScreenGenerationBlocker}</p>
              )}

              {workflow.workflow?.conceptScreenSet ? (
                <ConceptScreenGallery
                  artifact={workflow.workflow.conceptScreenSet}
                  projectName={project.name}
                />
              ) : (
                <section className={styles['artifact-empty']}>
                  <span aria-hidden="true">03</span>
                  <h2>Make the primary journey tangible</h2>
                  <p>Three coordinated, read-only Concept Screens will appear here after sequential image generation succeeds.</p>
                </section>
              )}
            </div>

            <ConceptScreenRunInspector
              run={workflow.workflow?.lastConceptScreenRun ?? null}
              generating={workflow.generatingStage === 'concept_screens'}
              elapsedSeconds={elapsedSeconds}
              progress={workflow.conceptScreenProgress}
            />
          </div>
        </main>
      )}

      {pendingImport && (
        <Modal
          title="Replace Insight Source?"
          onDismiss={() => setPendingImport(null)}
          actions={<>
            <button className={styles['secondary-action']} type="button" onClick={() => setPendingImport(null)}>Cancel</button>
            <button className={styles['primary-action']} type="button" onClick={() => {
              changeInsight(pendingImport.text);
              setPendingImport(null);
            }}>Replace insight</button>
          </>}
        >
          <p>Importing <strong>{pendingImport.name}</strong> will replace the text currently in this Project. The imported file itself will not be stored.</p>
        </Modal>
      )}
    </div>
  );
}
