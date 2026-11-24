import { useCallback, useEffect, useState } from 'react';
import type {
  CommitStageConfigurationInput,
  ModelCatalog,
  StageId,
  WorkflowConfiguration,
} from '../shared/workflow-configuration.js';

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

export interface WorkflowConfigurationController {
  configuration: WorkflowConfiguration | null;
  models: ModelCatalog | null;
  loading: boolean;
  error: string | null;
  savePromptDraft(stageId: StageId, draft: CommitStageConfigurationInput): Promise<void>;
  discardPromptDraft(stageId: StageId): Promise<void>;
  saveStage(stageId: StageId, input: CommitStageConfigurationInput): Promise<void>;
  resetStage(stageId: StageId): Promise<void>;
  resetWorkflow(): Promise<void>;
  importConfiguration(input: unknown): Promise<void>;
  exportConfiguration(): Promise<void>;
  refreshModels(): Promise<void>;
  clearError(): void;
}

export function useWorkflowConfiguration(): WorkflowConfigurationController {
  const [configuration, setConfiguration] = useState<WorkflowConfiguration | null>(null);
  const [models, setModels] = useState<ModelCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setLoadError(null);
      const [settings, catalog] = await Promise.allSettled([
        requestJson<WorkflowConfiguration>('/api/workflow-configuration'),
        requestJson<ModelCatalog>('/api/models'),
      ]);
      if (!active) return;
      const failed: string[] = [];
      if (settings.status === 'fulfilled') setConfiguration(settings.value);
      else failed.push('shared configuration');
      if (catalog.status === 'fulfilled') setModels(catalog.value);
      else failed.push('model catalog');
      if (failed.length) setLoadError(`Could not load the ${failed.join(' and ')}.`);
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setError(null);
    try {
      return await operation();
    } catch (operationError) {
      setError(operationError instanceof Error
        ? operationError.message
        : 'The Workflow Configuration action failed');
      throw operationError;
    }
  }, []);

  const savePromptDraft = useCallback(async (stageId: StageId, draft: CommitStageConfigurationInput) => {
    await run(async () => {
      setConfiguration(await requestJson<WorkflowConfiguration>(
        `/api/workflow-configuration/stages/${stageId}/draft`,
        { method: 'PUT', body: JSON.stringify(draft) },
      ));
    });
  }, [run]);

  const discardPromptDraft = useCallback(async (stageId: StageId) => {
    await run(async () => {
      setConfiguration(await requestJson<WorkflowConfiguration>(
        `/api/workflow-configuration/stages/${stageId}/draft`,
        { method: 'DELETE' },
      ));
    });
  }, [run]);

  const saveStage = useCallback(async (
    stageId: StageId,
    input: CommitStageConfigurationInput,
  ) => {
    await run(async () => {
      setConfiguration(await requestJson<WorkflowConfiguration>(
        `/api/workflow-configuration/stages/${stageId}/save`,
        { method: 'POST', body: JSON.stringify(input) },
      ));
    });
  }, [run]);

  const resetStage = useCallback(async (stageId: StageId) => {
    await run(async () => {
      setConfiguration(await requestJson<WorkflowConfiguration>(
        `/api/workflow-configuration/stages/${stageId}/reset`,
        { method: 'POST' },
      ));
    });
  }, [run]);

  const resetWorkflow = useCallback(async () => {
    await run(async () => {
      setConfiguration(await requestJson<WorkflowConfiguration>(
        '/api/workflow-configuration/reset',
        { method: 'POST' },
      ));
    });
  }, [run]);

  const importConfiguration = useCallback(async (input: unknown) => {
    await run(async () => {
      setConfiguration(await requestJson<WorkflowConfiguration>(
        '/api/workflow-configuration/import',
        { method: 'POST', body: JSON.stringify(input) },
      ));
    });
  }, [run]);

  const exportConfiguration = useCallback(async () => {
    await run(async () => {
      const response = await fetch('/api/workflow-configuration/export');
      if (!response.ok) {
        throw new Error(`Export failed with status ${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'insightforge-workflow-configuration.json';
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }, [run]);

  const refreshModels = useCallback(async () => {
    await run(async () => {
      setModels(await requestJson<ModelCatalog>('/api/models'));
    });
  }, [run]);

  return {
    configuration,
    loadError,
    retryLoad: () => setLoadAttempt(attempt => attempt + 1),
    models,
    loading,
    error,
    savePromptDraft,
    discardPromptDraft,
    saveStage,
    resetStage,
    resetWorkflow,
    importConfiguration,
    exportConfiguration,
    refreshModels,
    clearError: () => setError(null),
  };
}
