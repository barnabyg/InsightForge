import { useCallback, useEffect, useState } from 'react';
import type { ConceptScreenProgressEvent, ProjectWorkflow } from '../shared/generation.js';

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
  generatingStage: 'design_brief' | 'concept_screens' | 'prd' | null;
  cancelling: boolean;
  conceptScreenProgress: ConceptScreenProgressEvent | null;
  error: string | null;
  refresh(): Promise<ProjectWorkflow>;
  generateDesignBrief(): Promise<ProjectWorkflow>;
  generateConceptScreens(): Promise<ProjectWorkflow>;
  generatePrd(): Promise<ProjectWorkflow>;
  cancelConceptScreens(): Promise<void>;
  clearError(): void;
}

export function useProjectWorkflow(projectId: string): ProjectWorkflowController {
  const [workflow, setWorkflow] = useState<ProjectWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingStage, setGeneratingStage] = useState<'design_brief' | 'concept_screens' | 'prd' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [conceptScreenProgress, setConceptScreenProgress] = useState<ConceptScreenProgressEvent | null>(null);
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
    generating: generatingStage !== null,
    generatingStage,
    cancelling,
    conceptScreenProgress,
    error,
    refresh,

    async generateDesignBrief() {
      setGeneratingStage('design_brief');
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
        setGeneratingStage(null);
      }
    },

    async generateConceptScreens() {
      setGeneratingStage('concept_screens');
      setCancelling(false);
      setConceptScreenProgress(null);
      setError(null);
      const progressSource = new EventSource(
        `/api/projects/${projectId}/concept-screen-runs/events`,
      );
      progressSource.onmessage = (event) => {
        setConceptScreenProgress(JSON.parse(event.data) as ConceptScreenProgressEvent);
      };
      try {
        await new Promise<void>((resolve) => {
          const timeout = window.setTimeout(resolve, 1_000);
          progressSource.onopen = () => {
            window.clearTimeout(timeout);
            resolve();
          };
        });
        const next = await requestWorkflow(
          `/api/projects/${projectId}/concept-screen-runs`,
          { method: 'POST' },
        );
        setWorkflow(next);
        return next;
      } catch (generationError) {
        const message = generationError instanceof Error
          ? generationError.message
          : 'Concept Screen generation failed.';
        setError(message);
        await refresh().catch(() => undefined);
        throw generationError;
      } finally {
        progressSource.close();
        setGeneratingStage(null);
        setCancelling(false);
      }
    },

    async cancelConceptScreens() {
      setCancelling(true);
      const response = await fetch(
        `/api/projects/${projectId}/concept-screen-runs/active`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        setCancelling(false);
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? 'Concept Screen generation could not be cancelled.');
      }
    },

    async generatePrd() {
      setGeneratingStage('prd');
      setError(null);
      try {
        const next = await requestWorkflow(
          `/api/projects/${projectId}/prd-runs`,
          { method: 'POST' },
        );
        setWorkflow(next);
        return next;
      } catch (generationError) {
        const message = generationError instanceof Error
          ? generationError.message
          : 'PRD generation failed.';
        setError(message);
        await refresh().catch(() => undefined);
        throw generationError;
      } finally {
        setGeneratingStage(null);
      }
    },

    clearError() {
      setError(null);
    },
  };
}
