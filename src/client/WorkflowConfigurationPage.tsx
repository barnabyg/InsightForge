import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommitStageConfigurationInput,
  ImageQuality,
  ModelCatalog,
  StageConfiguration,
  StageId,
  StageInputId,
} from '../shared/workflow-configuration.js';
import { Modal } from './Modal.js';
import styles from './App.module.css';
import { useWorkflowConfiguration } from './useWorkflowConfiguration.js';

const inputPresentation: Record<StageInputId, { label: string; token: string }> = {
  insight_source: { label: 'Insight Source', token: '{insight_source}' },
  design_brief: { label: 'Design Brief', token: '{design_brief}' },
  concept_screen_set: { label: 'Concept Screen Set', token: '{concept_screen_set}' },
};

type DraftFeedback = 'active' | 'pending' | 'saving' | 'draft_saved' | 'active_saved' | 'error';

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function assembledRequest(stage: StageConfiguration, prompt: string): string {
  const inputs = stage.requiredInputs.map((input) => {
    const presentation = inputPresentation[input];
    return `<${input.toUpperCase()}>\n${presentation.token}\n</${input.toUpperCase()}>`;
  }).join('\n\n');
  return `[STAGE PROMPT]\n${prompt}\n\n[ATTACHED BY INSIGHTFORGE — APP-OWNED]\n${inputs}\n\n[OUTPUT CONTRACT]\n${stage.outputContract}`;
}

interface StageEditorProps {
  stage: StageConfiguration;
  models: ModelCatalog | null;
  onSaveDraft(stageId: StageId, draft: CommitStageConfigurationInput): Promise<void>;
  onDiscardDraft(stageId: StageId): Promise<void>;
  onSave(
    stageId: StageId,
    input: { prompt: string; model: string; imageQuality: ImageQuality | null },
  ): Promise<void>;
  onReset(stageId: StageId): Promise<void>;
}

function StageEditor({
  stage,
  models,
  onSaveDraft,
  onDiscardDraft,
  onSave,
  onReset,
}: StageEditorProps) {
  const active = { prompt: stage.prompt, model: stage.model, imageQuality: stage.imageQuality };
  const saved = {
    prompt: stage.draftPrompt?.prompt ?? stage.prompt,
    model: stage.draftPrompt?.model ?? stage.model,
    imageQuality: stage.draftPrompt?.imageQuality ?? stage.imageQuality,
  };
  const [draft, setDraft] = useState(saved);
  const { prompt, model, imageQuality } = draft;
  const [feedback, setFeedback] = useState<DraftFeedback>(
    stage.draftPrompt ? 'draft_saved' : 'active',
  );
  const [search, setSearch] = useState('');
  const [searchOffset, setSearchOffset] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(draft);
  const persisted = useRef(draft);
  const draftInFlight = useRef<Promise<void> | null>(null);

  function editDraft(change: Partial<CommitStageConfigurationInput>) {
    latest.current = { ...latest.current, ...change };
    setDraft(latest.current);
    setFeedback('pending');
    if ('model' in change || 'imageQuality' in change) {
      void persistLatestDraft().catch(() => undefined);
    }
  }

  useEffect(() => {
    if (latest.current !== persisted.current) return;
    persisted.current = saved;
    latest.current = saved;
    setDraft(saved);
    setFeedback(current => stage.draftPrompt ? 'draft_saved'
      : current === 'active_saved' ? current : 'active');
  }, [stage.updatedAt, stage.draftPrompt?.updatedAt, stage.id]);

  async function persistLatestDraft(): Promise<void> {
    if (draftInFlight.current) {
      await draftInFlight.current;
      if (latest.current !== persisted.current) {
        return persistLatestDraft();
      }
      return;
    }
    const value = latest.current;
    if (value === persisted.current) return;

    setFeedback('saving');
    const operation = (async () => {
      try {
        await onSaveDraft(stage.id, value);
        persisted.current = value;
        setFeedback(latest.current === value ? 'draft_saved' : 'pending');
      } catch (error) {
        setFeedback('error');
        throw error;
      } finally {
        draftInFlight.current = null;
      }
    })();
    draftInFlight.current = operation;
    return operation;
  }

  useEffect(() => {
    if (feedback !== 'pending') return;
    const timer = window.setTimeout(async () => {
      await persistLatestDraft().catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [feedback, onSaveDraft, prompt, stage.id]);

  useEffect(() => {
    function protectLocalSelection(event: BeforeUnloadEvent) {
      if (latest.current !== persisted.current) {
        event.preventDefault();
      }
    }
    window.addEventListener('beforeunload', protectLocalSelection);
    return () => window.removeEventListener('beforeunload', protectLocalSelection);
  }, []);

  const changed = prompt !== stage.prompt
    || model !== stage.model
    || imageQuality !== stage.imageQuality;
  const discoveredModels = !models ? [] : stage.id === 'prd'
    ? models.multimodalText
    : stage.kind === 'text'
      ? models.text
      : models.image;
  const modelOptions = [...new Set([
    stage.model,
    ...discoveredModels,
  ])].sort();
  const matchCount = useMemo(() => {
    if (!search) return 0;
    return prompt.toLowerCase().split(search.toLowerCase()).length - 1;
  }, [prompt, search]);

  function findNext() {
    if (!search || !editor.current) return;
    const lowerPrompt = prompt.toLowerCase();
    const lowerSearch = search.toLowerCase();
    let index = lowerPrompt.indexOf(lowerSearch, searchOffset);
    if (index < 0) index = lowerPrompt.indexOf(lowerSearch);
    if (index >= 0) {
      editor.current.focus();
      editor.current.setSelectionRange(index, index + search.length);
      setSearchOffset(index + search.length);
    }
  }

  const status = {
    active: { label: 'Active Stage Prompt', visible: 'Active prompt' },
    pending: { label: 'Prompt Draft has unsaved changes', visible: 'Draft pending' },
    saving: { label: 'Saving Prompt Draft', visible: 'Saving draft…' },
    draft_saved: { label: 'Prompt Draft saved locally', visible: 'Draft saved locally' },
    active_saved: { label: 'Active Stage Configuration saved', visible: 'Saved globally' },
    error: { label: 'Prompt Draft save failed', visible: 'Draft save failed' },
  }[feedback];

  return (
    <section className={styles['prompt-studio']} aria-labelledby="stage-editor-title">
      <header className={styles['prompt-studio-header']}>
        <div>
          <p className={styles.eyebrow}>Shared Stage Configuration</p>
          <h2 id="stage-editor-title">{stage.name}</h2>
        </div>
        <span className={styles['draft-status']} role="status" aria-label={status.label}>
          <span aria-hidden="true" /> {changed ? 'Unpublished changes · ' : ''}{status.visible}
        </span>
      </header>

      <div className={styles['configuration-grid']}>
        <div className={styles['prompt-editor-panel']}>
          <div className={styles['prompt-toolbar']}>
            <label>
              <span>Find in prompt</span>
              <input value={search} onChange={(event) => { setSearch(event.target.value); setSearchOffset(0); }} />
            </label>
            <span>{search ? `${matchCount} matches` : `${wordCount(prompt)} words`}</span>
            <button type="button" disabled={!search || matchCount === 0} onClick={findNext}>Find next</button>
          </div>
          <label className={styles['prompt-textarea-label']}>
            <span className={styles['visually-hidden']}>{stage.name} Stage Prompt</span>
            <textarea
              ref={editor}
              aria-label={`${stage.name} Stage Prompt`}
              value={prompt}
              wrap="soft"
              onChange={(event) => {
                editDraft({ prompt: event.target.value });
              }}
              onBlur={() => void persistLatestDraft().catch(() => undefined)}
            />
          </label>
          <footer className={styles['prompt-editor-footer']}>
            <span>{prompt.length.toLocaleString('en-GB')} characters</span>
            <span>Instructions only · Stage Inputs are protected</span>
          </footer>
        </div>

        <aside className={styles['configuration-controls']}>
          <section>
            <p className={styles.eyebrow}>OpenAI model</p>
            <label className={styles['select-label']}>
              Model for {stage.name}
              <select onBlur={() => void persistLatestDraft().catch(() => undefined)} value={model} onChange={(event) => editDraft({ model: event.target.value })}>
                {modelOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            {stage.kind === 'image' && (
              <label className={styles['select-label']}>
                Image quality
                <select
                  onBlur={() => void persistLatestDraft().catch(() => undefined)}
                  aria-label="Image quality"
                  value={imageQuality ?? 'medium'}
                  onChange={(event) => editDraft({ imageQuality: event.target.value as ImageQuality })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            )}
          </section>

          <section className={styles['protected-inputs']}>
            <div>
              <p className={styles.eyebrow}>Protected Stage Inputs</p>
              <span className={styles['locked-label']}>Locked by the workflow</span>
            </div>
            {stage.requiredInputs.map((input) => (
              <div className={styles['input-contract']} key={input}>
                <strong>{inputPresentation[input].label}</strong>
                <code>{inputPresentation[input].token}</code>
                <span>Attached by InsightForge · cannot be edited</span>
              </div>
            ))}
            <button className={styles['text-action']} type="button" onClick={() => setPreviewOpen(true)}>
              Preview assembled request
            </button>
          </section>
        </aside>
      </div>

      {(changed || stage.draftPrompt) && (
        <section className={styles['prompt-comparison']} aria-label="Compare prompt changes">
          <header>
            <div>
              <p className={styles.eyebrow}>Live comparison</p>
              <h3>Review before saving globally</h3>
              <p>{stage.name} · {model}{imageQuality ? ` · ${imageQuality} quality` : ''}. These settings apply to future runs in every project.</p>
            </div>
            <span>{wordCount(stage.prompt)} → {wordCount(prompt)} words</span>
          </header>
          <div>
            <article>
              <strong>Active Stage Prompt</strong>
              <pre>{stage.prompt}</pre>
            </article>
            <article>
              <strong>Prompt Draft</strong>
              <pre>{prompt}</pre>
            </article>
          </div>
        </section>
      )}

      <footer className={styles['studio-actions']}>
        <button className={styles['text-action']} type="button" onClick={() => setResetOpen(true)}>Reset this stage</button>
        <div>
          <button
            className={styles['secondary-action']}
            type="button"
            disabled={!stage.draftPrompt && !changed}
            onClick={() => void (async () => {
              try {
                await persistLatestDraft();
                await onDiscardDraft(stage.id);
                latest.current = active;
                persisted.current = active;
                setDraft(active);
                setFeedback('active');
              } catch {
                setFeedback('error');
              }
            })()}
          >Discard Prompt Draft</button>
          <button
            className={styles['primary-action']}
            type="button"
            disabled={!changed || !prompt.trim()}
            onClick={() => void (async () => {
              try {
                await persistLatestDraft();
                await onSave(stage.id, { prompt, model, imageQuality });
                persisted.current = latest.current;
                setFeedback('active_saved');
              } catch {
                setFeedback('error');
              }
            })()}
          >Save globally</button>
        </div>
      </footer>

      {previewOpen && (
        <Modal
          title="Assembled request preview"
          onDismiss={() => setPreviewOpen(false)}
          actions={<button className={styles['primary-action']} type="button" onClick={() => setPreviewOpen(false)}>Close preview</button>}
        >
          <p className={styles['preview-explanation']}>Stage Inputs and the output contract are attached by InsightForge and are not part of the editable prompt.</p>
          <pre className={styles['request-preview']}>{assembledRequest(stage, prompt)}</pre>
        </Modal>
      )}

      {resetOpen && (
        <Modal
          title={`Reset ${stage.name}?`}
          onDismiss={() => setResetOpen(false)}
          actions={(
            <>
              <button className={styles['secondary-action']} type="button" onClick={() => setResetOpen(false)}>Cancel</button>
              <button className={styles['danger-action']} type="button" onClick={() => void (async () => { await persistLatestDraft(); await onReset(stage.id); setResetOpen(false); })()}>Reset stage</button>
            </>
          )}
        >
          <p>The active prompt, model, and settings for <strong>{stage.name}</strong> will return to the bundled baseline. Projects will not be regenerated.</p>
          <dl className={styles['reset-summary']}>
            <div><dt>Model</dt><dd>{stage.model} → {stage.defaultConfiguration.model}</dd></div>
            <div><dt>Prompt</dt><dd>{wordCount(stage.prompt)} → {wordCount(stage.defaultConfiguration.prompt)} words</dd></div>
            {stage.kind === 'image' && (
              <div><dt>Image quality</dt><dd>{stage.imageQuality} → {stage.defaultConfiguration.imageQuality}</dd></div>
            )}
          </dl>
        </Modal>
      )}
    </section>
  );
}

interface PendingImport {
  name: string;
  value: unknown;
}

export function WorkflowConfigurationPage() {
  const controller = useWorkflowConfiguration();
  const params = new URLSearchParams(window.location.search);
  const origin = params.get('from');
  const originStage = params.get('stage');
  const initialStage = originStage === 'concept_screens' || originStage === 'prd'
    ? originStage : 'design_brief';
  const [selectedStage, setSelectedStage] = useState<StageId>(initialStage);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  async function chooseImport(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (!/\.json$/i.test(file.name)) {
      setFileError('Choose a Workflow Configuration .json file.');
      return;
    }
    try {
      setPendingImport({ name: file.name, value: JSON.parse(await file.text()) });
    } catch {
      setFileError('That file is not valid JSON.');
    }
  }

  const loadNotice = controller.loadError && (
    <div className={styles['inline-error']} role="alert">
      {controller.loadError} <button type="button" onClick={controller.retryLoad}>Retry</button>
    </div>
  );
  if (!controller.configuration) {
    return <main className={styles['main-content']}>{loadNotice ??
      <p role="status">Loading shared workflow configuration…</p>}</main>;
  }

  const stage = controller.configuration.stages.find(({ id }) => id === selectedStage)!;
  const catalog = controller.models;
  const catalogLabel = catalog && `${catalog.source === 'mock' ? 'Mock' : catalog.source === 'live' ? 'Live' : catalog.source === 'cache' ? 'Cached' : 'Default'} model catalog`;

  return (
    <main className={styles['configuration-page']}>
      {origin && <a className={styles['back-link']}
        href={`/?project=${encodeURIComponent(origin)}&stage=${initialStage}`}>
        Return to {controller.configuration.stages.find(item => item.id === initialStage)?.name}
      </a>}
      <header className={styles['configuration-hero']}>
        <div>
          <p className={styles.eyebrow}>The reusable heart of InsightForge</p>
          <h1>Shared workflow configuration</h1>
          <p>Improve one global set of prompts and model choices. Every Project uses the active configuration on its next run.</p>
        </div>
        <div className={styles['configuration-file-actions']}>
          <button className={styles['secondary-action']} type="button" onClick={() => void controller.exportConfiguration()}>Export configuration</button>
          <label className={styles['secondary-action']}>
            Import configuration
            <input
              className={styles['visually-hidden']}
              type="file"
              accept=".json,application/json"
              aria-label="Import Workflow Configuration file"
              onChange={(event) => { void chooseImport(event.target.files?.[0]); event.target.value = ''; }}
            />
          </label>
          <button className={styles['text-action']} type="button" onClick={() => setResetAllOpen(true)}>Reset entire workflow</button>
        </div>
      </header>

      {(controller.error || fileError) && (
        <div className={styles['inline-error']} role="alert">{controller.error ?? fileError}</div>
      )}

      {loadNotice}
      {catalog && <section className={styles['model-catalog-bar']}>
        <span><span className={styles['catalog-dot']} aria-hidden="true" /> {catalogLabel}</span>
        <span>{catalog.text.length} text · {catalog.multimodalText.length} PRD · {catalog.image.length} image</span>
        <button type="button" onClick={() => void controller.refreshModels()}>Refresh models</button>
      </section>}

      <div className={styles['stage-tabs']} role="tablist" aria-label="Generated stages">
        {controller.configuration.stages.map((candidate, index) => (
          <button
            role="tab"
            id={`tab-${candidate.id}`}
            aria-controls={`panel-${candidate.id}`}
            tabIndex={candidate.id === selectedStage ? 0 : -1}
            onKeyDown={event => {
              const stages = controller.configuration!.stages;
              const last = stages.length - 1;
              const target = {
                ArrowRight: (index + 1) % stages.length,
                ArrowLeft: (index + last) % stages.length,
                Home: 0,
                End: last,
              }[event.key];
              if (target === undefined) return;
              event.preventDefault();
              const next = stages[target]!.id;
              setSelectedStage(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
            aria-selected={candidate.id === selectedStage}
            type="button"
            key={candidate.id}
            onClick={() => setSelectedStage(candidate.id)}
          >
            <span>{String(index + 2).padStart(2, '0')}</span>
            <strong>{candidate.name}</strong>
            <small>{candidate.draftPrompt ? 'Draft saved' : candidate.model}</small>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${stage.id}`} aria-labelledby={`tab-${stage.id}`}>
      <StageEditor
        key={stage.id}
        stage={stage}
        models={controller.models}
        onSaveDraft={controller.savePromptDraft}
        onDiscardDraft={controller.discardPromptDraft}
        onSave={controller.saveStage}
        onReset={controller.resetStage}
      />
      </div>

      {pendingImport && (
        <Modal
          title="Import Workflow Configuration?"
          onDismiss={() => setPendingImport(null)}
          actions={(
            <>
              <button className={styles['secondary-action']} type="button" onClick={() => setPendingImport(null)}>Cancel</button>
              <button className={styles['primary-action']} type="button" onClick={() => void (async () => { try { await controller.importConfiguration(pendingImport.value); setPendingImport(null); } catch { /* visible alert */ } })()}>Import configuration</button>
            </>
          )}
        >
          <p><strong>{pendingImport.name}</strong> will replace all three active Stage Configurations after the complete file is validated. Existing Projects will not be regenerated.</p>
        </Modal>
      )}

      {resetAllOpen && (
        <Modal
          title="Reset entire workflow?"
          onDismiss={() => setResetAllOpen(false)}
          actions={(
            <>
              <button className={styles['secondary-action']} type="button" onClick={() => setResetAllOpen(false)}>Cancel</button>
              <button className={styles['danger-action']} type="button" onClick={() => void (async () => { await controller.resetWorkflow(); setResetAllOpen(false); })()}>Reset workflow</button>
            </>
          )}
        >
          <p>This restores all three active Stage Configurations to the bundled baseline and discards their Prompt Drafts. Projects are not regenerated.</p>
          <dl className={styles['reset-summary']}>
            {controller.configuration.stages.map((configuredStage) => (
              <div key={configuredStage.id}>
                <dt>{configuredStage.name}</dt>
                <dd>
                  {configuredStage.kind === 'image'
                    ? `${configuredStage.imageQuality?.replace(/^./, (letter) => letter.toUpperCase())} → ${configuredStage.defaultConfiguration.imageQuality?.replace(/^./, (letter) => letter.toUpperCase())}`
                    : `${configuredStage.model} → ${configuredStage.defaultConfiguration.model}`}
                </dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
    </main>
  );
}
