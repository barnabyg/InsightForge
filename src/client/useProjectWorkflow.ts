import { useCallback, useEffect, useState } from 'react';
import type {
  ConceptScreenProgressEvent,
  FullGenerationProgressEvent,
  GeneratedStageId,
  ProjectWorkflow,
  WorkflowRerunRequest,
} from '../shared/generation.js';

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
  generatingStage: 'full_generation' | 'design_brief' | 'concept_screens' | 'prd' | null;
  cancelling: boolean;
  conceptScreenProgress: ConceptScreenProgressEvent | null;
  fullGenerationProgress: FullGenerationProgressEvent | null;
  error: string | null;
  refresh(): Promise<ProjectWorkflow>;
  generateDesignBrief(): Promise<ProjectWorkflow>;
  generateConceptScreens(): Promise<ProjectWorkflow>;
  generatePrd(): Promise<ProjectWorkflow>;
  generateFullWorkflow(): Promise<ProjectWorkflow>;
  regenerateWorkflow(startStage: GeneratedStageId): Promise<ProjectWorkflow>;
  beginInsightRevision(): Promise<ProjectWorkflow>;
  updateInsightRevision(insightSource: string): Promise<ProjectWorkflow>;
  generateInsightRevision(): Promise<ProjectWorkflow>;
  discardInsightRevision(): Promise<ProjectWorkflow>;
  resumeFullWorkflow(): Promise<ProjectWorkflow>;
  promoteFullWorkflow(): Promise<ProjectWorkflow>;
  keepCandidateAfterWarningReview(): Promise<ProjectWorkflow>;
  discardFullWorkflow(): Promise<ProjectWorkflow>;
  cancelFullWorkflow(): Promise<void>;
  cancelConceptScreens(): Promise<void>;
  clearError(): void;
}

export function useProjectWorkflow(projectId: string): ProjectWorkflowController {
  const [workflow, setWorkflow] = useState<ProjectWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingStage, setGeneratingStage] = useState<
    'full_generation' | 'design_brief' | 'concept_screens' | 'prd' | null
  >(null);
  const [cancelling, setCancelling] = useState(false);
  const [conceptScreenProgress, setConceptScreenProgress] = useState<ConceptScreenProgressEvent | null>(null);
  const [fullGenerationProgress, setFullGenerationProgress] = useState<FullGenerationProgressEvent | null>(null);
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

  useEffect(() => {
    if (workflow?.candidate?.status !== 'running' || generatingStage !== null) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [generatingStage, refresh, workflow?.candidate?.status]);

  return {
    workflow,
    loading,
    generating: generatingStage !== null,
    generatingStage,
    cancelling,
    conceptScreenProgress,
    fullGenerationProgress,
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

    async generateFullWorkflow() {
      return runFullGeneration(`/api/projects/${projectId}/full-generations`);
    },

    async regenerateWorkflow(startStage) {
      return runFullGeneration(
        `/api/projects/${projectId}/workflow-reruns`,
        {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            stageId: startStage,
          } satisfies WorkflowRerunRequest),
        },
      );
    },

    async beginInsightRevision() {
      const next = await requestWorkflow(
        `/api/projects/${projectId}/insight-revisions`,
        { method: 'POST' },
      );
      setWorkflow(next);
      return next;
    },

    async updateInsightRevision(insightSource) {
      const next = await requestWorkflow(
        `/api/projects/${projectId}/insight-revisions/active`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ insightSource }),
        },
      );
      setWorkflow(next);
      return next;
    },

    async generateInsightRevision() {
      return runFullGeneration(
        `/api/projects/${projectId}/insight-revisions/active/generation`,
      );
    },

    async discardInsightRevision() {
      const next = await requestWorkflow(
        `/api/projects/${projectId}/insight-revisions/active`,
        { method: 'DELETE' },
      );
      setWorkflow(next);
      return next;
    },

    async resumeFullWorkflow() {
      return runFullGeneration(`/api/projects/${projectId}/full-generations/resume`);
    },

    async promoteFullWorkflow() {
      setError(null);
      const next = await requestWorkflow(
        `/api/projects/${projectId}/full-generations/promotion`,
        { method: 'POST' },
      );
      setWorkflow(next);
      return next;
    },

    async keepCandidateAfterWarningReview() {
      setError(null);
      const next = await requestWorkflow(
        `/api/projects/${projectId}/full-generations/warning-review/keep`,
        { method: 'POST' },
      );
      setWorkflow(next);
      return next;
    },

    async discardFullWorkflow() {
      setError(null);
      const next = await requestWorkflow(
        `/api/projects/${projectId}/full-generations/candidate`,
        { method: 'DELETE' },
      );
      setWorkflow(next);
      setFullGenerationProgress(null);
      return next;
    },

    async cancelFullWorkflow() {
      setCancelling(true);
      const response = await fetch(
        `/api/projects/${projectId}/full-generations/active`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        setCancelling(false);
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? 'Full Generation could not be cancelled.');
      }
    },

    clearError() {
      setError(null);
    },
  };

  async function runFullGeneration(
    url: string,
    init: Omit<RequestInit, 'method'> = {},
  ): Promise<ProjectWorkflow> {
    setGeneratingStage('full_generation');
    setCancelling(false);
    setFullGenerationProgress(null);
    setError(null);
    const progressSource = new EventSource(
      `/api/projects/${projectId}/full-generations/events`,
    );
    progressSource.onmessage = (event) => {
      setFullGenerationProgress(JSON.parse(event.data) as FullGenerationProgressEvent);
    };
    try {
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 1_000);
        progressSource.onopen = () => {
          window.clearTimeout(timeout);
          resolve();
        };
      });
      let next = await requestWorkflow(url, { ...init, method: 'POST' });
      while (next.candidate?.status === 'paused') {
        next = await requestWorkflow(
          `/api/projects/${projectId}/full-generations/resume`,
          { method: 'POST' },
        );
      }
      if (next.candidate?.status === 'awaiting_promotion') {
        next = await requestWorkflow(
          `/api/projects/${projectId}/full-generations/promotion`,
          { method: 'POST' },
        );
      }
      setWorkflow(next);
      return next;
    } catch (generationError) {
      const message = generationError instanceof Error
        ? generationError.message
        : 'Full Generation failed.';
      setError(message);
      await refresh().catch(() => undefined);
      throw generationError;
    } finally {
      progressSource.close();
      setGeneratingStage(null);
      setCancelling(false);
    }
  }
}
