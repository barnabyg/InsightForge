import { ConnectivityIndicator } from './ConnectivityIndicator.js';
import { ProjectLibrary } from './ProjectLibrary.js';
import { ProjectWorkspace } from './ProjectWorkspace.js';
import { WorkflowConfigurationPage } from './WorkflowConfigurationPage.js';
import styles from './App.module.css';
import { useBootstrap } from './useBootstrap.js';
import { useProjects } from './useProjects.js';
import { useEffect, useState } from 'react';

function classes(...names: string[]): string {
  return names.map((name) => styles[name]).filter(Boolean).join(' ');
}

export function App() {
  const {
    shell,
    refreshConnectivity,
    refreshStorage,
    refreshing,
  } = useBootstrap();
  const projects = useProjects();
  const [view, setView] = useState<'projects' | 'prompts'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'prompts'
      ? 'prompts'
      : 'projects');

  useEffect(() => {
    function followViewHistory() {
      setView(new URLSearchParams(window.location.search).get('view') === 'prompts'
        ? 'prompts'
        : 'projects');
    }
    window.addEventListener('popstate', followViewHistory);
    return () => window.removeEventListener('popstate', followViewHistory);
  }, []);

  useEffect(() => {
    if (!projects.currentProject) void refreshStorage();
  }, [projects.currentProject, projects.projects, refreshStorage]);

  function showView(nextView: 'projects' | 'prompts') {
    setView(nextView);
    if (nextView === 'projects') {
      void projects.refreshLibrary();
    }
    window.history.pushState(
      {},
      '',
      nextView === 'prompts' ? '/?view=prompts' : '/',
    );
  }

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
          onEditPrompts={() => {
            projects.showLibrary();
            showView('prompts');
          }}
          onSaveInsight={(insightSource) =>
            projects.updateInsightSource(projects.currentProject!.id, insightSource)}
          onRevisionPromoted={projects.refreshCurrentProject}
        />
      ) : (
        <div className={classes('workspace')}>
          <aside className={classes('sidebar')} aria-label="Project navigation">
            <div>
              <p className={classes('eyebrow')}>Workspace</p>
              <nav>
                <a
                  className={classes('nav-item', view === 'projects' ? 'nav-item--active' : '')}
                  href="/"
                  aria-current={view === 'projects' ? 'page' : undefined}
                  onClick={(event) => { event.preventDefault(); showView('projects'); }}
                >
                  <span>Projects</span>
                  <span>{String(projects.projects.length).padStart(2, '0')}</span>
                </a>
                <a
                  className={classes('nav-item', view === 'prompts' ? 'nav-item--active' : '')}
                  href="/?view=prompts"
                  aria-current={view === 'prompts' ? 'page' : undefined}
                  onClick={(event) => { event.preventDefault(); showView('prompts'); }}
                >
                  <span>Prompts</span>
                  <span aria-hidden="true">↗</span>
                </a>
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

          {view === 'projects' ? <ProjectLibrary
            projects={projects.projects}
            storage={shell.storage}
            loading={projects.loading}
            onCreate={() => projects.createProject()}
            onImport={projects.importProject}
            onOpen={projects.openProject}
            onRename={projects.renameProject}
            onDuplicate={projects.duplicateProject}
            onDelete={projects.deleteProject}
          /> : <WorkflowConfigurationPage />}
        </div>
      )}
    </div>
  );
}
