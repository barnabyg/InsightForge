import { useCallback, useEffect, useState } from 'react';
import type { ProjectWorkflow } from '../shared/generation.js';

async function requestWorkflow(url: string, init?: RequestInit): Promise<ProjectWorkflow> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<ProjectWorkflow>;
}

export interface ProjectWorkflowController {
  workflow: ProjectWorkflow | null;
  loading: boolean;
  generating: boolean;
  error: string | null;
  refresh(): Promise<ProjectWorkflow>;
  generateDesignBrief(): Promise<ProjectWorkflow>;
  clearError(): void;
}

export function useProjectWorkflow(projectId: string): ProjectWorkflowController {
  const [workflow, setWorkflow] = useState<ProjectWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await requestWorkflow(`/api/projects/${projectId}/workflow`);
    setWorkflow(next);
    return next;
  }, [projectId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setWorkflow(null);
    setError(null);
    requestWorkflow(`/api/projects/${projectId}/workflow`)
      .then((next) => {
        if (active) setWorkflow(next);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error
            ? loadError.message
            : 'The Project workflow could not be loaded.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  return {
    workflow,
    loading,
    generating,
    error,
    refresh,

    async generateDesignBrief() {
      setGenerating(true);
      setError(null);
      try {
        const next = await requestWorkflow(
          `/api/projects/${projectId}/design-brief-runs`,
          { method: 'POST' },
        );
        setWorkflow(next);
        return next;
      } catch (generationError) {
        const message = generationError instanceof Error
          ? generationError.message
          : 'Design Brief generation failed.';
        setError(message);
        await refresh().catch(() => undefined);
        throw generationError;
      } finally {
        setGenerating(false);
      }
    },

    clearError() {
      setError(null);
    },
  };
}
