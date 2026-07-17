import { useCallback, useEffect, useState } from 'react';
import type {
  CreateProjectInput,
  Project,
  ProjectSummary,
} from '../shared/projects.js';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body
      ? { 'content-type': 'application/json', ...init.headers }
      : init?.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface ProjectsController {
  projects: ProjectSummary[];
  currentProject: Project | null;
  loading: boolean;
  error: string | null;
  createProject(input?: CreateProjectInput): Promise<Project>;
  openProject(id: string): Promise<void>;
  refreshLibrary(): Promise<void>;
  showLibrary(): void;
  updateInsightSource(id: string, insightSource: string): Promise<Project>;
  renameProject(id: string, name: string): Promise<void>;
  duplicateProject(id: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  clearError(): void;
}

export function useProjects(): ProjectsController {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    setProjects(await requestJson<ProjectSummary[]>('/api/projects'));
  }, []);

  const loadProject = useCallback(async (id: string, updateLocation: boolean) => {
    const project = await requestJson<Project>(`/api/projects/${id}`);
    setCurrentProject(project);
    if (updateLocation) {
      window.history.pushState({}, '', `/?project=${encodeURIComponent(id)}`);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const library = await requestJson<ProjectSummary[]>('/api/projects');
        if (!active) return;
        setProjects(library);
        const projectId = new URLSearchParams(window.location.search).get('project');
        if (projectId) {
          const project = await requestJson<Project>(`/api/projects/${projectId}`);
          if (active) setCurrentProject(project);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Projects could not be loaded');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function followBrowserHistory() {
      const projectId = new URLSearchParams(window.location.search).get('project');
      if (!projectId) {
        setCurrentProject(null);
        setError(null);
        return;
      }
      try {
        const project = await requestJson<Project>(`/api/projects/${projectId}`);
        if (active) {
          setCurrentProject(project);
          setError(null);
        }
      } catch (historyError) {
        if (active) {
          setCurrentProject(null);
          setError(historyError instanceof Error
            ? historyError.message
            : 'The Project could not be loaded');
        }
      }
    }
    window.addEventListener('popstate', followBrowserHistory);
    return () => {
      active = false;
      window.removeEventListener('popstate', followBrowserHistory);
    };
  }, []);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setError(null);
    try {
      return await operation();
    } catch (operationError) {
      const message = operationError instanceof Error
        ? operationError.message
        : 'The Project action failed';
      setError(message);
      throw operationError;
    }
  }, []);

  return {
    projects,
    currentProject,
    loading,
    error,
    refreshLibrary,

    async createProject(input = {}) {
      return run(async () => {
        const project = await requestJson<Project>('/api/projects', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        setCurrentProject(project);
        await refreshLibrary();
        window.history.pushState({}, '', `/?project=${encodeURIComponent(project.id)}`);
        return project;
      });
    },

    async openProject(id) {
      await run(() => loadProject(id, true));
    },

    showLibrary() {
      setCurrentProject(null);
      setError(null);
      window.history.pushState({}, '', '/');
      void refreshLibrary().catch((refreshError) => {
        setError(refreshError instanceof Error
          ? refreshError.message
          : 'Projects could not be refreshed');
      });
    },

    async updateInsightSource(id, insightSource) {
      return run(async () => {
        const project = await requestJson<Project>(`/api/projects/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ insightSource }),
        });
        setCurrentProject(project);
        await refreshLibrary();
        return project;
      });
    },

    async renameProject(id, name) {
      await run(async () => {
        const project = await requestJson<Project>(`/api/projects/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        setCurrentProject((current) => current?.id === id ? project : current);
        await refreshLibrary();
      });
    },

    async duplicateProject(id) {
      await run(async () => {
        await requestJson<Project>(`/api/projects/${id}/duplicate`, { method: 'POST' });
        await refreshLibrary();
      });
    },

    async deleteProject(id) {
      await run(async () => {
        const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
        if (!response.ok) {
          throw new Error(`Delete failed with status ${response.status}`);
        }
        if (currentProject?.id === id) {
          setCurrentProject(null);
          window.history.pushState({}, '', '/');
        }
        await refreshLibrary();
      });
    },

    clearError() {
      setError(null);
    },
  };
}
