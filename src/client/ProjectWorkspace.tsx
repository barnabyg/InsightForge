import { useEffect, useRef, useState } from 'react';
import { generatedStageIds, generatedStageNames } from '../shared/generation.js';
import type { CandidateWorkflow, GeneratedStageId } from '../shared/generation.js';
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
  onEditPrompts(): void;
  onSaveInsight(insightSource: string): Promise<Project>;
  onRevisionPromoted(): Promise<Project>;
}

type SaveState = 'saved' | 'pending' | 'saving' | 'error';
type SelectedStage = 'insight_source' | 'design_brief' | 'concept_screens' | 'prd';

interface PendingImport {
  name: string;
  text: string;
}

type CandidatePrimaryAction = 'cancel' | 'promote' | 'resume';

const candidatePresentationByStatus = {
  running: {
    heading: 'Candidate generation continues',
    locationPrefix: 'currently at',
    primaryAction: 'cancel',
    primaryActionLabel: 'Cancel after current operation',
    canKeep: false,
    canDiscard: false,
  },
  paused: {
    heading: 'Candidate paused safely',
    locationPrefix: 'stopped at',
    primaryAction: 'resume',
    primaryActionLabel: 'Resume Candidate Workflow',
    canKeep: false,
    canDiscard: true,
  },
  failed: {
    heading: 'Candidate generation failed',
    locationPrefix: 'stopped at',
    primaryAction: 'resume',
    primaryActionLabel: 'Resume Candidate Workflow',
    canKeep: false,
    canDiscard: true,
  },
  cancelled: {
    heading: 'Candidate cancelled safely',
    locationPrefix: 'stopped at',
    primaryAction: 'resume',
    primaryActionLabel: 'Resume Candidate Workflow',
    canKeep: false,
    canDiscard: true,
  },
  awaiting_promotion: {
    heading: 'Candidate ready for promotion',
    locationPrefix: 'ready at',
    primaryAction: 'promote',
    primaryActionLabel: 'Promote Candidate Workflow',
    canKeep: false,
    canDiscard: true,
  },
  awaiting_warning_review: {
    heading: 'Candidate ready for warning review',
    locationPrefix: 'ready at',
    primaryAction: 'promote',
    primaryActionLabel: 'Promote Candidate Workflow',
    canKeep: true,
    canDiscard: true,
  },
  kept_after_warning_review: {
    heading: 'Candidate kept for later',
    locationPrefix: 'ready at',
    primaryAction: 'promote',
    primaryActionLabel: 'Promote Candidate Workflow',
    canKeep: false,
    canDiscard: true,
  },
} satisfies Record<CandidateWorkflow['status'], {
  heading: string;
  locationPrefix: string;
  primaryAction: CandidatePrimaryAction;
  primaryActionLabel: string;
  canKeep: boolean;
  canDiscard: boolean;
}>;

export function ProjectWorkspace({
  project,
  onShowLibrary,
  onEditPrompts,
  onSaveInsight,
  onRevisionPromoted,
}: ProjectWorkspaceProps) {
  const [selectedStage, setSelectedStage] = useState<SelectedStage>('insight_source');
  const [insight, setInsight] = useState(project.insightSource);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [confirmCascade, setConfirmCascade] = useState<'regeneration' | 'variation' | null>(null);
  const [confirmRerun, setConfirmRerun] = useState<GeneratedStageId | null>(null);
  const [confirmFullGeneration, setConfirmFullGeneration] = useState(false);
  const [revisionEditorOpen, setRevisionEditorOpen] = useState(false);
  const [confirmRevisionGeneration, setConfirmRevisionGeneration] = useState(false);
  const [revisionDraft, setRevisionDraft] = useState<string | null>(null);
  const [revisionSaveState, setRevisionSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
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
    const persisted = workflow.workflow?.insightRevision?.insightSource;
    if (!revisionEditorOpen || revisionDraft === null || persisted === undefined) return;
    if (revisionDraft === persisted) {
      setRevisionSaveState('saved');
      return;
    }
    setRevisionSaveState('saving');
    const timer = window.setTimeout(() => {
      void workflow.updateInsightRevision(revisionDraft)
        .then(() => setRevisionSaveState('saved'))
        .catch(() => setRevisionSaveState('error'));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [revisionDraft, revisionEditorOpen, workflow.workflow?.insightRevision?.insightSource]);

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

  async function openRevisionEditor(): Promise<void> {
    const next = workflow.workflow?.insightRevision
      ? workflow.workflow
      : await workflow.beginInsightRevision();
    if (!next.insightRevision) return;
    setRevisionDraft(next.insightRevision.insightSource);
    setRevisionSaveState('saved');
    setRevisionEditorOpen(true);
  }

  async function reviewRevisionGeneration(): Promise<void> {
    if (revisionDraft === null) return;
    await workflow.updateInsightRevision(revisionDraft);
    setRevisionSaveState('saved');
    setRevisionEditorOpen(false);
    setConfirmRevisionGeneration(true);
  }

  function applyPromotedProject(nextProject: Project): void {
    setInsight(nextProject.insightSource);
    latestInsight.current = nextProject.insightSource;
    savedInsight.current = nextProject.insightSource;
    setSaveState('saved');
  }

  async function generateRevision(): Promise<void> {
    const next = await workflow.generateInsightRevision();
    if (!next.insightRevision && !next.candidate) {
      applyPromotedProject(await onRevisionPromoted());
    }
  }

  const savePresentation = {
    saved: { label: 'Insight Source saved', visible: 'Saved locally' },
    pending: { label: 'Insight Source has unsaved changes', visible: 'Changes pending' },
    saving: { label: 'Saving Insight Source', visible: 'Saving…' },
    error: { label: 'Insight Source save failed', visible: 'Save failed' },
  }[saveState];
  const rerunPlan = workflow.workflow?.rerunPlan ?? null;
  const completeWorkflow = Boolean(
    workflow.workflow?.designBrief
    && workflow.workflow.conceptScreenSet
    && workflow.workflow.prd,
  );
  const affectedStage = (stageId: GeneratedStageId) =>
    rerunPlan?.affectedStages.includes(stageId) ?? false;
  const designBriefState = workflow.generating
    ? 'Generating'
    : rerunPlan?.earliestChangedStage === 'design_brief'
      ? 'Update Available'
    : workflow.workflow?.designBrief
      ? 'Current'
      : insight.trim()
        ? 'Ready'
        : 'Waiting';
  const conceptScreenState = workflow.generatingStage === 'concept_screens'
    ? 'Generating'
    : rerunPlan?.earliestChangedStage === 'concept_screens'
      ? 'Update Available'
    : affectedStage('concept_screens')
      ? 'Affected'
    : workflow.workflow?.conceptScreenSet
      ? 'Current'
      : workflow.workflow?.designBrief
        ? 'Ready'
        : 'Waiting';
  const prdState = workflow.generatingStage === 'prd'
    ? 'Generating'
    : rerunPlan?.earliestChangedStage === 'prd'
      ? 'Update Available'
    : affectedStage('prd')
      ? 'Affected'
    : workflow.workflow?.prd
      ? 'Current'
      : workflow.workflow?.conceptScreenSet
        ? 'Ready'
        : 'Waiting';
  const insightLocked = Boolean(
    workflow.workflow?.designBrief
    || workflow.workflow?.candidate
    || workflow.generatingStage === 'full_generation',
  );
  const fullProgress = workflow.fullGenerationProgress;
  const candidate = workflow.workflow?.candidate;
  const candidatePresentation = candidate
    ? candidatePresentationByStatus[candidate.status]
    : null;
  const candidatePrimaryAction = candidatePresentation
    ? async () => {
        if (candidatePresentation.primaryAction === 'cancel') {
          await workflow.cancelFullWorkflow();
          return;
        }
        const hadInsightRevision = Boolean(workflow.workflow?.insightRevision);
        const next = candidatePresentation.primaryAction === 'promote'
          ? await workflow.promoteFullWorkflow()
          : await workflow.resumeFullWorkflow();
        if (hadInsightRevision && !next.insightRevision && !next.candidate) {
          applyPromotedProject(await onRevisionPromoted());
        }
      }
    : null;
  const fullStageName = {
    design_brief: 'Design Brief',
    concept_screens: 'Concept Screens',
    prd: 'PRD',
    promotion: 'promotion',
  }[fullProgress?.currentStage ?? candidate?.currentStage ?? 'design_brief'];
  const fullProgressLabel = fullProgress
    ? {
        generating: fullStageName,
        validating: 'Validating Candidate Workflow',
        awaiting_warning_review: 'Reviewing Candidate Workflow warnings',
        promoting: 'Promoting Candidate Workflow',
        completed: 'Candidate Workflow promoted',
        failed: 'Candidate Workflow failed',
        cancelled: 'Candidate Workflow cancelled',
      }[fullProgress.phase]
    : fullStageName;

  function rerunStartFor(stageId: GeneratedStageId): GeneratedStageId {
    if (!rerunPlan) return stageId;
    return rerunPlan.earliestChangedStage;
  }

  function completeWorkflowActionLabel(stageId: GeneratedStageId): string {
    if (!rerunPlan) return 'Regenerate from here';
    const startStage = rerunStartFor(stageId);
    return startStage === stageId
      ? 'Regenerate from here'
      : `Regenerate from ${generatedStageNames[startStage]}`;
  }

  function hasCurrentArtifact(stageId: GeneratedStageId): boolean {
    if (stageId === 'design_brief') return Boolean(workflow.workflow?.designBrief);
    if (stageId === 'concept_screens') return Boolean(workflow.workflow?.conceptScreenSet);
    return Boolean(workflow.workflow?.prd);
  }

  function requestRegeneration(stageId: GeneratedStageId): void {
    const startStage = rerunStartFor(stageId);
    if (completeWorkflow) {
      setConfirmRerun(startStage);
    } else if (startStage === 'design_brief') {
      if (workflow.workflow?.conceptScreenSet) {
        setConfirmCascade('regeneration');
      } else {
        void workflow.generateDesignBrief().catch(() => undefined);
      }
    } else if (startStage === 'concept_screens') {
      void workflow.generateConceptScreens().catch(() => undefined);
    } else {
      void workflow.generatePrd().catch(() => undefined);
    }
  }

  function requestVariation(stageId: GeneratedStageId): void {
    if (completeWorkflow) {
      setConfirmRerun(stageId);
    } else if (stageId === 'design_brief') {
      if (workflow.workflow?.conceptScreenSet) {
        setConfirmCascade('variation');
      } else {
        void workflow.generateDesignBrief().catch(() => undefined);
      }
    } else if (stageId === 'concept_screens') {
      void workflow.generateConceptScreens().catch(() => undefined);
    } else {
      void workflow.generatePrd().catch(() => undefined);
    }
  }

  function variationAction(stageId: GeneratedStageId) {
    if (rerunPlan || !hasCurrentArtifact(stageId)) return null;
    return (
      <button
        className={`${styles['secondary-action']} ${styles['variation-action']}`}
        type="button"
        disabled={workflow.loading || workflow.generating}
        onClick={() => requestVariation(stageId)}
      >Generate another variation</button>
    );
  }

  function updateAvailableNotice(stageId: GeneratedStageId) {
    if (rerunPlan?.earliestChangedStage !== stageId) return null;
    return (
      <section
        className={styles['update-available']}
        role="status"
        aria-label="Update available"
      >
        <div>
          <p className={styles.eyebrow}>Update Available</p>
          <strong>{generatedStageNames[stageId]} inputs or configuration changed</strong>
        </div>
        <ul>
          {rerunPlan.changes.map((change) => (
            <li key={`${change.stageId}-${change.kind}`}>
              {generatedStageNames[change.stageId]} · {change.message}
            </li>
          ))}
        </ul>
        <p>
          Regeneration replaces {rerunPlan.affectedStages
            .map((affected) => generatedStageNames[affected]).join(', ')} together.
        </p>
        <details>
          <summary>Inspect fingerprints</summary>
          {rerunPlan.fingerprints.map((comparison) => (
            <div className={styles['fingerprint-comparison']} key={comparison.stageId}>
              <strong>{generatedStageNames[comparison.stageId]}</strong>
              {(['input', 'prompt', 'model', 'settings'] as const).map((kind) => (
                <div key={kind}>
                  <code>Previous {kind}: {comparison.previous[kind]}</code>
                  <code>Current {kind}: {comparison.current[kind]}</code>
                </div>
              ))}
            </div>
          ))}
        </details>
      </section>
    );
  }

  const confirmedRerunStages = confirmRerun
    ? generatedStageIds.slice(generatedStageIds.indexOf(confirmRerun))
    : [];
  const confirmedOperationCount = confirmRerun === 'design_brief'
    ? 5
    : confirmRerun === 'concept_screens'
      ? 4
      : 1;
  const confirmedRunIsVariation = rerunPlan === null;

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
          <li className={selectedStage === 'prd' ? styles['stage-rail-active'] : ''}>
            <button type="button" onClick={() => void selectStage('prd')}>
              <span className={styles['rail-number']}>04</span>
              <span><strong>PRD</strong><small>{prdState}</small></span>
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
              <div className={styles['editor-actions']}>
                {completeWorkflow && (
                  <button
                    className={styles['secondary-action']}
                    type="button"
                    disabled={Boolean(candidate) || workflow.generating}
                    onClick={() => void openRevisionEditor().catch(() => undefined)}
                  >{workflow.workflow?.insightRevision
                      ? 'Resume Insight Revision'
                      : 'Revise Insight'}</button>
                )}
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
                Insight Source is locked after generation. Use Revise Insight to prepare a replacement without changing the current workflow.
              </p>
            )}
            {importError && <p className={styles['inline-error']} role="alert">{importError}</p>}
          </section>

          {workflow.error && (
            <div className={styles['workspace-error']} role="alert">
              <span>{workflow.error}</span>
              <button type="button" onClick={workflow.clearError}>Dismiss</button>
            </div>
          )}

          <section className={styles['full-generation-card']} aria-label="Full Generation">
            <div className={styles['full-generation-heading']}>
              <div>
                <p className={styles.eyebrow}>One-pass workflow</p>
                <h2>Generate the complete workflow</h2>
                <p>One Design Brief request, three sequential Concept Screens, and one PRD request. Current artifacts change only after the complete Candidate Workflow succeeds.</p>
              </div>
              {!candidate
                && !workflow.workflow?.insightRevision
                && workflow.generatingStage !== 'full_generation' && (
                <button
                  className={completeWorkflow && !rerunPlan
                    ? styles['secondary-action']
                    : styles['primary-action']}
                  type="button"
                  disabled={!insight.trim() || saveState === 'saving'}
                  onClick={() => {
                    if (completeWorkflow) {
                      setConfirmRerun(rerunStartFor('design_brief'));
                    } else {
                      setConfirmFullGeneration(true);
                    }
                  }}
                >{completeWorkflow
                    ? rerunPlan
                      ? 'Regenerate complete workflow'
                      : 'Generate another full variation'
                    : 'Generate complete workflow'}</button>
              )}
            </div>

            {workflow.generatingStage === 'full_generation' && (
              <div
                className={styles['full-generation-progress']}
                role="status"
                aria-label="Generating complete workflow"
                aria-live="polite"
              >
                <div>
                  <strong>{fullProgressLabel}{fullProgress?.currentOrdinal ? ` · Screen ${fullProgress.currentOrdinal} of 3` : ''}</strong>
                  <span>{fullProgress?.completedOperationCount ?? candidate?.completedOperationCount ?? 0} of 5 operations complete · {elapsedSeconds}s elapsed</span>
                </div>
                <progress value={fullProgress?.completedOperationCount ?? candidate?.completedOperationCount ?? 0} max={5} />
                <button
                  className={styles['secondary-action']}
                  type="button"
                  disabled={workflow.cancelling}
                  onClick={() => void workflow.cancelFullWorkflow().catch(() => undefined)}
                >{workflow.cancelling ? 'Cancelling…' : 'Cancel after current operation'}</button>
              </div>
            )}

            {candidate && workflow.generatingStage !== 'full_generation' && (
              <div className={styles['candidate-summary']} role="status">
                <div>
                  <strong>
                    {candidate.runKind === 'variation' ? 'Variation Run' : candidatePresentation?.heading}
                  </strong>
                  <span>{candidate.completedOperationCount} of 5 operations complete · {candidatePresentation?.locationPrefix} {fullStageName}</span>
                  {candidate.error && <p>{candidate.error.message}</p>}
                </div>
                {candidate.warnings.length > 0 && (
                  <div className={styles['candidate-warnings']}>
                    <strong>{candidate.warnings.length} sanity {candidate.warnings.length === 1 ? 'warning' : 'warnings'}</strong>
                    <ul>{candidate.warnings.map((warning) => (
                      <li key={`${warning.stageId}-${warning.code}`}>{warning.message}</li>
                    ))}</ul>
                  </div>
                )}
                <div className={styles['candidate-actions']}>
                  <button
                    className={candidatePresentation?.primaryAction === 'cancel'
                      ? styles['secondary-action']
                      : styles['primary-action']}
                    type="button"
                    onClick={() => {
                      void candidatePrimaryAction?.().catch(() => undefined);
                    }}
                  >{candidatePresentation?.primaryActionLabel}</button>
                  {candidatePresentation?.canKeep && (
                    <button className={styles['secondary-action']} type="button" onClick={() => {
                      void workflow.keepCandidateAfterWarningReview().catch(() => undefined);
                    }}>Keep Candidate Workflow</button>
                  )}
                  {candidatePresentation?.canDiscard && (
                    <button className={styles['danger-action']} type="button" onClick={() => {
                      void workflow.discardFullWorkflow().catch(() => undefined);
                    }}>Discard Candidate Workflow</button>
                  )}
                </div>
              </div>
            )}
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
                <a
                  href="/?view=prompts"
                  onClick={(event) => {
                    event.preventDefault();
                    onEditPrompts();
                  }}
                >Edit shared prompt</a>
                <button
                  className={styles['primary-action']}
                  type="button"
                  disabled={workflow.loading || workflow.generating || (
                    !completeWorkflow && !workflow.workflow?.canGenerateDesignBrief
                  ) || (hasCurrentArtifact('design_brief') && !rerunPlan)}
                  onClick={() => requestRegeneration('design_brief')}
                >
                  {workflow.generating
                    ? 'Generating…'
                    : rerunPlan || hasCurrentArtifact('design_brief')
                      ? completeWorkflowActionLabel('design_brief')
                      : 'Generate Design Brief'}
                </button>
                {variationAction('design_brief')}
              </section>

              {updateAvailableNotice('design_brief')}

              {!completeWorkflow && workflow.workflow?.generationBlocker && (
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
              generating={workflow.generatingStage === 'design_brief'}
              elapsedSeconds={elapsedSeconds}
              stageName="Design Brief"
            />
          </div>
        </main>
      ) : selectedStage === 'concept_screens' ? (
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
                <a
                  href="/?view=prompts"
                  onClick={(event) => {
                    event.preventDefault();
                    onEditPrompts();
                  }}
                >Edit shared prompt</a>
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
                    disabled={workflow.loading || workflow.generating || (
                      !completeWorkflow && !workflow.workflow?.canGenerateConceptScreens
                    ) || (hasCurrentArtifact('concept_screens') && !rerunPlan)}
                    onClick={() => requestRegeneration('concept_screens')}
                  >
                    {rerunPlan || hasCurrentArtifact('concept_screens')
                      ? completeWorkflowActionLabel('concept_screens')
                      : workflow.workflow?.lastConceptScreenRun
                      && workflow.workflow.lastConceptScreenRun.status !== 'succeeded'
                      && workflow.workflow.lastConceptScreenRun.completedOperationCount < 3
                      ? `Resume from Screen ${workflow.workflow.lastConceptScreenRun.completedOperationCount + 1}`
                      : 'Generate Concept Screens'}
                  </button>
                )}
                {workflow.generatingStage !== 'concept_screens'
                  && variationAction('concept_screens')}
              </section>

              {updateAvailableNotice('concept_screens')}

              {!completeWorkflow && workflow.workflow?.conceptScreenGenerationBlocker && (
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
      ) : (
        <main className={`${styles['artifact-canvas']} ${styles['design-brief-canvas']}`}>
          <header className={styles['project-heading']}>
            <div>
              <p className={styles.eyebrow}>Stage 04 · {project.name}</p>
              <h1>PRD</h1>
            </div>
            {workflow.workflow?.prd && (
              <span className={styles['artifact-date']}>
                Generated <time dateTime={workflow.workflow.prd.createdAt}>
                  {new Date(workflow.workflow.prd.createdAt).toLocaleString('en-GB')}
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
              <section className={styles['stage-action-card']} aria-label="PRD generation">
                <div>
                  <p className={styles.eyebrow}>Shared Stage Configuration</p>
                  <strong>{workflow.workflow?.prdConfiguration.model ?? 'Loading model…'}</strong>
                  <span>Uses the protected Design Brief and all three current Concept Screens. The Insight Source is not attached separately.</span>
                </div>
                <a
                  href="/?view=prompts"
                  onClick={(event) => {
                    event.preventDefault();
                    onEditPrompts();
                  }}
                >Edit shared prompt</a>
                <button
                  className={styles['primary-action']}
                  type="button"
                  disabled={workflow.loading || workflow.generating || (
                    !completeWorkflow && !workflow.workflow?.canGeneratePrd
                  ) || (hasCurrentArtifact('prd') && !rerunPlan)}
                  onClick={() => requestRegeneration('prd')}
                >
                  {workflow.generatingStage === 'prd'
                    ? 'Generating…'
                    : rerunPlan || hasCurrentArtifact('prd')
                      ? completeWorkflowActionLabel('prd')
                      : 'Generate PRD'}
                </button>
                {variationAction('prd')}
              </section>

              {updateAvailableNotice('prd')}

              {workflow.workflow?.prdGenerationBlocker && (
                <p className={styles['generation-blocker']}>{workflow.workflow.prdGenerationBlocker}</p>
              )}

              {workflow.workflow?.prd ? (
                <MarkdownArtifact artifact={workflow.workflow.prd} projectName={project.name} />
              ) : (
                <section className={styles['artifact-empty']}>
                  <span aria-hidden="true">04</span>
                  <h2>Turn product intent into requirements</h2>
                  <p>The PRD will reconcile the Design Brief and all three Concept Screens in one read-only Markdown Artifact.</p>
                </section>
              )}
            </div>

            <RunInspector
              run={workflow.workflow?.lastPrdRun ?? null}
              generating={workflow.generatingStage === 'prd'}
              elapsedSeconds={elapsedSeconds}
              stageName="PRD"
            />
          </div>
        </main>
      )}

      {revisionEditorOpen && revisionDraft !== null && (
        <Modal
          title="Revise Insight"
          onDismiss={() => setRevisionEditorOpen(false)}
          actions={<>
            <button className={styles['secondary-action']} type="button" onClick={() => setRevisionEditorOpen(false)}>Close for now</button>
            <button className={styles['danger-action']} type="button" onClick={() => {
              void workflow.discardInsightRevision().then(() => {
                setRevisionEditorOpen(false);
                setRevisionDraft(null);
              }).catch(() => undefined);
            }}>Discard revision</button>
            <button
              className={styles['primary-action']}
              type="button"
              disabled={
                !revisionDraft.trim()
                || revisionDraft === insight
                || revisionSaveState === 'saving'
              }
              onClick={() => void reviewRevisionGeneration().catch(() => undefined)}
            >Review regeneration</button>
          </>}
        >
          <div className={styles['revision-editor']}>
            <p>The current Insight Source and every current Artifact stay unchanged until the complete replacement workflow is promoted.</p>
            <label>
              <span>Revised Insight Source</span>
              <textarea
                aria-label="Revised Insight Source"
                value={revisionDraft}
                onChange={(event) => setRevisionDraft(event.target.value)}
              />
            </label>
            <span
              className={styles['revision-save-state']}
              role="status"
              aria-label={revisionSaveState === 'saved'
                ? 'Insight Revision saved'
                : revisionSaveState === 'saving'
                  ? 'Saving Insight Revision'
                  : 'Insight Revision save failed'}
            >{revisionSaveState === 'saved'
                ? 'Revision saved locally'
                : revisionSaveState === 'saving'
                  ? 'Saving revision…'
                  : 'Revision could not be saved'}</span>
          </div>
        </Modal>
      )}

      {confirmRevisionGeneration && (
        <Modal
          title="Generate revised workflow?"
          onDismiss={() => setConfirmRevisionGeneration(false)}
          actions={<>
            <button className={styles['secondary-action']} type="button" onClick={() => {
              setConfirmRevisionGeneration(false);
              setRevisionEditorOpen(true);
            }}>Back to revision</button>
            <button className={styles['primary-action']} type="button" onClick={() => {
              setConfirmRevisionGeneration(false);
              void generateRevision().catch(() => undefined);
            }}>Generate revised workflow</button>
          </>}
        >
          <p>The revised Insight Source changes the input to the complete downstream chain:</p>
          <ul>
            <li>Design Brief · {workflow.workflow?.designBriefConfiguration.model ?? 'current text model'}</li>
            <li>Concept Screens · {workflow.workflow?.conceptScreenConfiguration.model ?? 'current image model'} · {workflow.workflow?.conceptScreenConfiguration.imageQuality ?? 'current'} quality</li>
            <li>PRD · {workflow.workflow?.prdConfiguration.model ?? 'current text model'}</li>
          </ul>
          <p>5 OpenAI operations will run with no automatic retry.</p>
          <p>The current coherent workflow remains visible throughout generation and after any failure or cancellation. Promotion replaces the Insight Source and all three Artifacts together, preserving the current workflow as a Workflow Snapshot.</p>
        </Modal>
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

      {confirmCascade && (
        <Modal
          title={confirmCascade === 'variation'
            ? 'Generate another Design Brief variation?'
            : 'Rerun downstream workflow?'}
          onDismiss={() => setConfirmCascade(null)}
          actions={<>
            <button className={styles['secondary-action']} type="button" onClick={() => setConfirmCascade(null)}>Cancel</button>
            <button className={styles['primary-action']} type="button" onClick={() => {
              setConfirmCascade(null);
              void workflow.generateDesignBrief().catch(() => undefined);
            }}>{confirmCascade === 'variation'
                ? 'Generate Variation Run and Concept Screens'
                : 'Rerun Design Brief and Concept Screens'}</button>
          </>}
        >
          {confirmCascade === 'variation' ? (
            <p>The Design Brief input and configuration are unchanged, so its new run will be recorded as a <strong>Variation Run</strong>. It will then generate three new Concept Screens to keep downstream lineage coherent.</p>
          ) : (
            <p>This cascade will generate a new Design Brief and then three new Concept Screens.</p>
          )}
          <p>The current Design Brief and Concept Screen Set remain available unless the complete cascade succeeds.</p>
        </Modal>
      )}

      {confirmRerun && (
        <Modal
          title={confirmedRunIsVariation
            ? `Generate another ${generatedStageNames[confirmRerun]} variation?`
            : `Regenerate from ${generatedStageNames[confirmRerun]}?`}
          onDismiss={() => setConfirmRerun(null)}
          actions={<>
            <button className={styles['secondary-action']} type="button" onClick={() => setConfirmRerun(null)}>Cancel</button>
            <button className={styles['primary-action']} type="button" onClick={() => {
              const startStage = confirmRerun;
              setConfirmRerun(null);
              void workflow.regenerateWorkflow(startStage).catch(() => undefined);
            }}>{confirmedRunIsVariation ? 'Generate Variation Run' : 'Start regeneration'}</button>
          </>}
        >
          {confirmedRunIsVariation ? (
            <p>The Stage Input, prompt, model, and settings are identical to the current run. This will be recorded as a <strong>Variation Run</strong>.</p>
          ) : (
            <>
              <p>Changes detected:</p>
              <ul>
                {rerunPlan?.changes.filter((change) => (
                  confirmedRerunStages.includes(change.stageId)
                )).map((change) => (
                  <li key={`${change.stageId}-${change.kind}`}>
                    {generatedStageNames[change.stageId]} · {change.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p>This Candidate Workflow will replace:</p>
          <ul>
            {confirmedRerunStages.map((stageId) => (
              <li key={stageId}>
                {generatedStageNames[stageId]} · {
                  stageId === 'design_brief'
                    ? workflow.workflow?.designBriefConfiguration.model
                    : stageId === 'concept_screens'
                      ? `${workflow.workflow?.conceptScreenConfiguration.model} · ${workflow.workflow?.conceptScreenConfiguration.imageQuality} quality`
                      : workflow.workflow?.prdConfiguration.model
                }
              </li>
            ))}
          </ul>
          <p>{confirmedOperationCount} OpenAI {confirmedOperationCount === 1 ? 'operation' : 'operations'} will run with no automatic retry.</p>
          <p>The current coherent workflow remains visible during generation and will be preserved automatically as a Workflow Snapshot immediately before promotion.</p>
        </Modal>
      )}

      {confirmFullGeneration && (
        <Modal
          title="Generate complete workflow?"
          onDismiss={() => setConfirmFullGeneration(false)}
          actions={<>
            <button className={styles['secondary-action']} type="button" onClick={() => setConfirmFullGeneration(false)}>Cancel</button>
            <button className={styles['primary-action']} type="button" onClick={() => {
              setConfirmFullGeneration(false);
              void (async () => {
                await flushLatestInsight();
                await workflow.refresh();
                await workflow.generateFullWorkflow();
              })().catch(() => undefined);
            }}>Start 5 operations</button>
          </>}
        >
          <p>The Candidate Workflow will use:</p>
          <ul>
            <li>Design Brief · {workflow.workflow?.designBriefConfiguration.model ?? 'current text model'}</li>
            <li>Concept Screens · {workflow.workflow?.conceptScreenConfiguration.model ?? 'current image model'} · {workflow.workflow?.conceptScreenConfiguration.imageQuality ?? 'current'} quality</li>
            <li>PRD · {workflow.workflow?.prdConfiguration.model ?? 'current text model'}</li>
          </ul>
          <p>No automatic retry is performed. You can cancel between operations, and the current workflow remains untouched until promotion.</p>
        </Modal>
      )}
    </div>
  );
}
