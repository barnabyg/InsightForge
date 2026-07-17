import { useState } from 'react';
import type { ProjectSummary } from '../shared/projects.js';
import { Modal } from './Modal.js';
import styles from './App.module.css';

interface ProjectLibraryProps {
  projects: ProjectSummary[];
  loading: boolean;
  onCreate(): Promise<unknown>;
  onOpen(id: string): Promise<void>;
  onRename(id: string, name: string): Promise<void>;
  onDuplicate(id: string): Promise<void>;
  onDelete(id: string): Promise<void>;
}

interface RenameState {
  id: string;
  name: string;
}

function formatActivity(updatedAt: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(updatedAt));
}

export function ProjectLibrary({
  projects,
  loading,
  onCreate,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: ProjectLibraryProps) {
  const [rename, setRename] = useState<RenameState | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);

  async function perform(action: () => Promise<void>, after?: () => void) {
    setBusy(true);
    try {
      await action();
      after?.();
    } catch {
      // The app-level alert presents the controller's error to the Author.
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles['main-content']} id="projects">
      <section className={styles['library-hero']} aria-labelledby="hero-title">
        <div>
          <p className={styles.eyebrow}>Product thinking, forged through iteration</p>
          <h1 id="hero-title">Turn an insight into a product direction.</h1>
          <p className={styles['hero-copy']}>
            Shape the prompts. Run the workflow. Refine the thinking behind every artifact.
          </p>
        </div>
        <button
          className={styles['primary-action']}
          type="button"
          disabled={busy}
          onClick={() => void perform(async () => { await onCreate(); })}
        >
          <span aria-hidden="true">＋</span>
          Create project
        </button>
      </section>

      <aside className={styles['privacy-notice']} aria-label="Privacy and OpenAI boundary">
        <span className={styles['privacy-mark']} aria-hidden="true">◎</span>
        <div>
          <strong>Projects stay on this device.</strong>
          <p>
            When you generate, only the assembled prompt and required stage inputs are sent to OpenAI.
          </p>
        </div>
      </aside>

      <section className={styles['project-library']} aria-labelledby="library-title">
        <div className={styles['section-heading']}>
          <div>
            <p className={styles.eyebrow}>Project library</p>
            <h2 id="library-title">Recent lines of thought</h2>
          </div>
          <span className={styles['section-meta']}>
            {projects.length} {projects.length === 1 ? 'Project' : 'Projects'} · locally saved
          </span>
        </div>

        {loading ? (
          <p className={styles['library-loading']}>Loading local Projects…</p>
        ) : projects.length === 0 ? (
          <div className={styles['empty-state']}>
            <span className={styles['empty-glyph']} aria-hidden="true">✦</span>
            <div>
              <h2>Your first Project starts with a signal.</h2>
              <p>Create a Project, then write or import the Insight Source that will drive it.</p>
            </div>
          </div>
        ) : (
          <div className={styles['project-grid']}>
            {projects.map((project, index) => (
              <article
                className={styles['project-card']}
                aria-label={project.name}
                key={project.id}
              >
                <div className={styles['project-card-topline']}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <span className={styles['project-status']}>
                    {project.prdPresent
                      ? 'PRD ready'
                      : project.conceptScreenSetPresent
                      ? 'Concept Screens ready'
                      : project.designBriefPresent
                      ? 'Design Brief ready'
                      : project.insightSourcePresent
                        ? 'Insight captured'
                        : 'Awaiting insight'}
                  </span>
                </div>
                <button
                  className={styles['project-open']}
                  type="button"
                  onClick={() => void perform(() => onOpen(project.id))}
                >
                  <h3>{project.name}</h3>
                  <span>Open Project <span aria-hidden="true">→</span></span>
                </button>
                <footer className={styles['project-card-footer']}>
                  <time dateTime={project.updatedAt}>Updated {formatActivity(project.updatedAt)}</time>
                  <div className={styles['project-actions']}>
                    <button type="button" aria-label="Rename project" onClick={() => setRename({ id: project.id, name: project.name })}>Rename</button>
                    <button type="button" aria-label="Duplicate project" disabled={busy} onClick={() => void perform(() => onDuplicate(project.id))}>Duplicate</button>
                    <button type="button" aria-label="Delete project" onClick={() => setDeleting(project)}>Delete</button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      {rename && (
        <Modal
          title="Rename Project"
          onDismiss={() => setRename(null)}
          actions={(
            <>
              <button className={styles['secondary-action']} type="button" onClick={() => setRename(null)}>Cancel</button>
              <button
                className={styles['primary-action']}
                type="button"
                disabled={!rename.name.trim() || busy}
                onClick={() => void perform(
                  () => onRename(rename.id, rename.name),
                  () => setRename(null),
                )}
              >Save name</button>
            </>
          )}
        >
          <label className={styles['field-label']}>
            Project name
            <input autoFocus value={rename.name} onChange={(event) => setRename({ ...rename, name: event.target.value })} />
          </label>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Delete Project?"
          onDismiss={() => setDeleting(null)}
          actions={(
            <>
              <button className={styles['secondary-action']} type="button" onClick={() => setDeleting(null)}>Keep Project</button>
              <button
                className={styles['danger-action']}
                type="button"
                disabled={busy}
                onClick={() => void perform(
                  () => onDelete(deleting.id),
                  () => setDeleting(null),
                )}
              >Delete project</button>
            </>
          )}
        >
          <p>
            <strong>{deleting.name}</strong> and its workflow will be removed from this device. This cannot be undone.
          </p>
        </Modal>
      )}
    </main>
  );
}
