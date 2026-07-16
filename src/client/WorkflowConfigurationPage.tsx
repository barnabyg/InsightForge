import { useEffect, useMemo, useRef, useState } from 'react';
import type {
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
  models: ModelCatalog;
  onSaveDraft(stageId: StageId, prompt: string): Promise<void>;
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
  const initialPrompt = stage.draftPrompt?.prompt ?? stage.prompt;
  const [prompt, setPrompt] = useState(initialPrompt);
  const [model, setModel] = useState(stage.model);
  const [imageQuality, setImageQuality] = useState(stage.imageQuality);
  const [feedback, setFeedback] = useState<DraftFeedback>(
    stage.draftPrompt ? 'draft_saved' : 'active',
  );
  const [search, setSearch] = useState('');
  const [searchOffset, setSearchOffset] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const latestPrompt = useRef(initialPrompt);
  const persistedPrompt = useRef(stage.draftPrompt?.prompt ?? stage.prompt);
  const draftInFlight = useRef<Promise<void> | null>(null);
  const activeSignature = useRef(
    `${stage.prompt}\u0000${stage.model}\u0000${stage.imageQuality ?? ''}`,
  );

  useEffect(() => {
    const signature = `${stage.prompt}\u0000${stage.model}\u0000${stage.imageQuality ?? ''}`;
    const nextPrompt = stage.draftPrompt?.prompt ?? stage.prompt;
    if (signature !== activeSignature.current) {
      activeSignature.current = signature;
      persistedPrompt.current = nextPrompt;
      latestPrompt.current = nextPrompt;
      const needsSync = prompt !== nextPrompt
        || model !== stage.model
        || imageQuality !== stage.imageQuality;
      setPrompt(nextPrompt);
      setModel(stage.model);
      setImageQuality(stage.imageQuality);
      if (needsSync) {
        setFeedback(stage.draftPrompt ? 'draft_saved' : 'active');
      }
      return;
    }
    if (
      stage.draftPrompt
      && latestPrompt.current === stage.prompt
      && stage.draftPrompt.prompt !== stage.prompt
    ) {
      latestPrompt.current = stage.draftPrompt.prompt;
      persistedPrompt.current = stage.draftPrompt.prompt;
      setPrompt(stage.draftPrompt.prompt);
      setFeedback('draft_saved');
    }
  }, [stage.prompt, stage.model, stage.imageQuality, stage.draftPrompt]);

  async function persistLatestPrompt(): Promise<void> {
    if (draftInFlight.current) {
      await draftInFlight.current;
      if (latestPrompt.current !== persistedPrompt.current) {
        return persistLatestPrompt();
      }
      return;
    }
    const value = latestPrompt.current;
    if (value === persistedPrompt.current) return;

    setFeedback('saving');
    const operation = (async () => {
      try {
        await onSaveDraft(stage.id, value);
        persistedPrompt.current = value;
        setFeedback(latestPrompt.current === value ? 'draft_saved' : 'pending');
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
      await persistLatestPrompt().catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [feedback, onSaveDraft, prompt, stage.id]);

  useEffect(() => {
    function protectLocalSelection(event: BeforeUnloadEvent) {
      if (model !== stage.model || imageQuality !== stage.imageQuality) {
        event.preventDefault();
      }
    }
    window.addEventListener('beforeunload', protectLocalSelection);
    return () => window.removeEventListener('beforeunload', protectLocalSelection);
  }, [imageQuality, model, stage.imageQuality, stage.model]);

  const changed = prompt !== stage.prompt
    || model !== stage.model
    || imageQuality !== stage.imageQuality;
  const modelOptions = [...new Set([
    stage.model,
    ...(stage.kind === 'text' ? models.text : models.image),
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
          <span aria-hidden="true" /> {status.visible}
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
                setPrompt(event.target.value);
                latestPrompt.current = event.target.value;
                setFeedback('pending');
              }}
              onBlur={() => void persistLatestPrompt().catch(() => undefined)}
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
              <select value={model} onChange={(event) => setModel(event.target.value)}>
                {modelOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            {stage.kind === 'image' && (
              <label className={styles['select-label']}>
                Image quality
                <select
                  aria-label="Image quality"
                  value={imageQuality ?? 'medium'}
                  onChange={(event) => setImageQuality(event.target.value as ImageQuality)}
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
            disabled={!stage.draftPrompt && prompt === stage.prompt}
            onClick={() => void (async () => {
              try {
                await persistLatestPrompt();
                await onDiscardDraft(stage.id);
                setPrompt(stage.prompt);
                latestPrompt.current = stage.prompt;
                persistedPrompt.current = stage.prompt;
                setModel(stage.model);
                setImageQuality(stage.imageQuality);
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
                await persistLatestPrompt();
                await onSave(stage.id, { prompt, model, imageQuality });
                persistedPrompt.current = prompt;
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
              <button className={styles['danger-action']} type="button" onClick={() => void (async () => { await persistLatestPrompt(); await onReset(stage.id); setResetOpen(false); })()}>Reset stage</button>
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
  const [selectedStage, setSelectedStage] = useState<StageId>('design_brief');
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

  if (controller.loading || !controller.configuration || !controller.models) {
    return <main className={styles['main-content']}><p className={styles['library-loading']}>Loading shared workflow configuration…</p></main>;
  }

  const stage = controller.configuration.stages.find(({ id }) => id === selectedStage)!;
  const catalogLabel = `${controller.models.source === 'mock' ? 'Mock' : controller.models.source === 'live' ? 'Live' : controller.models.source === 'cache' ? 'Cached' : 'Default'} model catalog`;

  return (
    <main className={styles['configuration-page']}>
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

      <section className={styles['model-catalog-bar']}>
        <span><span className={styles['catalog-dot']} aria-hidden="true" /> {catalogLabel}</span>
        <span>{controller.models.text.length} text · {controller.models.image.length} image</span>
        <button type="button" onClick={() => void controller.refreshModels()}>Refresh models</button>
      </section>

      <div className={styles['stage-tabs']} role="tablist" aria-label="Generated stages">
        {controller.configuration.stages.map((candidate, index) => (
          <button
            role="tab"
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

      <StageEditor
        key={stage.id}
        stage={stage}
        models={controller.models}
        onSaveDraft={controller.savePromptDraft}
        onDiscardDraft={controller.discardPromptDraft}
        onSave={controller.saveStage}
        onReset={controller.resetStage}
      />

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
