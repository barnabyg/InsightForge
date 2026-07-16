import { ConnectivityIndicator } from './ConnectivityIndicator.js';
import { ProjectLibrary } from './ProjectLibrary.js';
import { ProjectWorkspace } from './ProjectWorkspace.js';
import styles from './App.module.css';
import { useBootstrap } from './useBootstrap.js';
import { useProjects } from './useProjects.js';

function classes(...names: string[]): string {
  return names.map((name) => styles[name]).filter(Boolean).join(' ');
}

export function App() {
  const { shell, refreshConnectivity, refreshing } = useBootstrap();
  const projects = useProjects();

  return (
    <div className={classes('app-frame')}>
      <header className={classes('topbar')}>
        <a className={classes('brand')} href="/" aria-label="InsightForge home">
          <span className={classes('brand-mark')} aria-hidden="true">IF</span>
          <span>InsightForge</span>
        </a>
        <ConnectivityIndicator
          shell={shell}
          refreshing={refreshing}
          onRefresh={refreshConnectivity}
        />
      </header>

      {projects.error && (
        <div className={styles['app-error']} role="alert">
          <span>{projects.error}</span>
          <button type="button" onClick={projects.clearError}>Dismiss</button>
        </div>
      )}

      {projects.currentProject ? (
        <ProjectWorkspace
          project={projects.currentProject}
          onShowLibrary={projects.showLibrary}
          onSaveInsight={(insightSource) =>
            projects.updateInsightSource(projects.currentProject!.id, insightSource)}
        />
      ) : (
        <div className={classes('workspace')}>
          <aside className={classes('sidebar')} aria-label="Project navigation">
            <div>
              <p className={classes('eyebrow')}>Workspace</p>
              <nav>
                <a className={classes('nav-item', 'nav-item--active')} href="#projects" aria-current="page">
                  <span>Projects</span>
                  <span>{String(projects.projects.length).padStart(2, '0')}</span>
                </a>
                <span className={classes('nav-item', 'nav-item--muted')}>
                  <span>Prompts</span>
                  <span aria-hidden="true">↗</span>
                </span>
              </nav>
            </div>
            <div className={classes('local-note')}>
              <span className={classes('local-note-icon')} aria-hidden="true">⌂</span>
              <div>
                <strong>Local workspace</strong>
                <span>Project data is stored locally</span>
              </div>
            </div>
          </aside>

          <ProjectLibrary
            projects={projects.projects}
            loading={projects.loading}
            onCreate={() => projects.createProject()}
            onOpen={projects.openProject}
            onRename={projects.renameProject}
            onDuplicate={projects.duplicateProject}
            onDelete={projects.deleteProject}
          />
        </div>
      )}
    </div>
  );
}
