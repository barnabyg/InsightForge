import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  CommitStageConfigurationInput,
  ImageQuality,
  StageConfiguration,
  StageId,
  WorkflowConfiguration,
  WorkflowConfigurationExport,
  WorkflowConfigurationExportStage,
} from '../shared/workflow-configuration.js';
import { initializeStorage } from './storage.js';
import {
  isCompatibleImageModel,
  isCompatibleTextModel,
} from './model-discovery.js';
import {
  defaultStage,
  defaultStageConfigurations,
} from './workflow-defaults.js';

interface StageRow {
  stage_id: StageId;
  prompt: string;
  model: string;
  image_quality: ImageQuality | null;
  updated_at: string;
  draft_prompt: string | null;
  draft_updated_at: string | null;
}

export interface WorkflowConfigurationServiceOptions {
  now?: () => Date;
}

export interface WorkflowConfigurationService {
  getWorkflowConfiguration(): WorkflowConfiguration;
  savePromptDraft(stageId: StageId, prompt: string): void;
  discardPromptDraft(stageId: StageId): void;
  commitStageConfiguration(
    stageId: StageId,
    input: CommitStageConfigurationInput,
  ): void;
  resetStageConfiguration(stageId: StageId): void;
  resetWorkflowConfiguration(): void;
  exportWorkflowConfiguration(): WorkflowConfigurationExport;
  importWorkflowConfiguration(input: unknown): void;
  close(): void;
}

export class WorkflowConfigurationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowConfigurationValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function parseWorkflowConfigurationExport(
  input: unknown,
): WorkflowConfigurationExportStage[] {
  if (!isRecord(input) || input.schemaVersion !== 1) {
    throw new WorkflowConfigurationValidationError(
      'Unsupported Workflow Configuration schema version',
    );
  }
  if (!hasOnlyKeys(input, ['schemaVersion', 'stages'])) {
    throw new WorkflowConfigurationValidationError(
      'Workflow Configuration contains unknown fields',
    );
  }
  if (!Array.isArray(input.stages) || input.stages.length !== 3) {
    throw new WorkflowConfigurationValidationError(
      'Workflow Configuration must contain exactly three stages',
    );
  }

  const parsed = new Map<StageId, WorkflowConfigurationExportStage>();
  for (const candidate of input.stages) {
    if (!isRecord(candidate)) {
      throw new WorkflowConfigurationValidationError(
        'Every Stage Configuration must be an object',
      );
    }
    if (!hasOnlyKeys(candidate, ['id', 'prompt', 'model', 'imageQuality'])) {
      throw new WorkflowConfigurationValidationError(
        'Stage Configuration contains unknown fields',
      );
    }
    const { id, prompt, model, imageQuality } = candidate;
    if (
      id !== 'design_brief'
      && id !== 'concept_screens'
      && id !== 'prd'
    ) {
      throw new WorkflowConfigurationValidationError(
        'Workflow Configuration contains an unknown stage',
      );
    }
    const stageId: StageId = id;
    if (parsed.has(stageId)) {
      throw new WorkflowConfigurationValidationError(
        `Workflow Configuration contains duplicate stage ${id}`,
      );
    }
    if (typeof prompt !== 'string' || typeof model !== 'string') {
      throw new WorkflowConfigurationValidationError(
        `Stage Configuration ${id} requires prompt and model text`,
      );
    }
    const definition = defaultStage(stageId);
    const normalizedQuality = imageQuality === null
      ? null
      : imageQuality === 'low' || imageQuality === 'medium' || imageQuality === 'high'
        ? imageQuality
        : undefined;
    if (
      normalizedQuality === undefined
      || (definition.kind === 'text' && normalizedQuality !== null)
      || (definition.kind === 'image' && normalizedQuality === null)
    ) {
      throw new WorkflowConfigurationValidationError(
        `Stage Configuration ${id} has invalid image quality`,
      );
    }
    const stage: WorkflowConfigurationExportStage = {
      id: stageId,
      prompt,
      model,
      imageQuality: normalizedQuality,
    };
    parsed.set(stageId, stage);
  }

  return defaultStageConfigurations.map(({ id }) => {
    const stage = parsed.get(id);
    if (!stage) {
      throw new WorkflowConfigurationValidationError(
        `Workflow Configuration is missing stage ${id}`,
      );
    }
    return stage;
  });
}

export async function openWorkflowConfigurationService(
  dataDirectory: string,
  options: WorkflowConfigurationServiceOptions = {},
): Promise<WorkflowConfigurationService> {
  await initializeStorage(dataDirectory);
  const database = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
  database.exec('PRAGMA foreign_keys = ON;');
  const now = options.now ?? (() => new Date());

  function validateCommit(
    stageId: StageId,
    input: CommitStageConfigurationInput,
  ): void {
    const definition = defaultStage(stageId);
    if (!input.prompt.trim()) {
      throw new WorkflowConfigurationValidationError(
        'Stage Prompt cannot be empty',
      );
    }
    if (!input.model.trim()) {
      throw new WorkflowConfigurationValidationError(
        'OpenAI model cannot be empty',
      );
    }
    if (
      definition.kind === 'text'
      && !isCompatibleTextModel(input.model.trim())
    ) {
      throw new WorkflowConfigurationValidationError(
        `${definition.name} requires a compatible text model`,
      );
    }
    if (
      definition.kind === 'image'
      && !isCompatibleImageModel(input.model.trim())
    ) {
      throw new WorkflowConfigurationValidationError(
        `${definition.name} requires a compatible image model`,
      );
    }
    if (definition.kind === 'text' && input.imageQuality !== null) {
      throw new WorkflowConfigurationValidationError(
        'Image quality applies only to Concept Screens',
      );
    }
    if (definition.kind === 'image' && input.imageQuality === null) {
      throw new WorkflowConfigurationValidationError(
        'Concept Screens require an image quality',
      );
    }
  }

  function replaceWithDefaults(stageIds: StageId[]): void {
    const timestamp = now().toISOString();
    const update = database.prepare(`
      UPDATE stage_configurations
      SET prompt = ?, model = ?, image_quality = ?, updated_at = ?
      WHERE stage_id = ?
    `);
    const deleteDraft = database.prepare(
      'DELETE FROM prompt_drafts WHERE stage_id = ?',
    );
    database.exec('BEGIN IMMEDIATE;');
    try {
      for (const stageId of stageIds) {
        const stage = defaultStage(stageId);
        update.run(
          stage.prompt,
          stage.model,
          stage.imageQuality,
          timestamp,
          stage.id,
        );
        deleteDraft.run(stage.id);
      }
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  function readWorkflowConfiguration(): WorkflowConfiguration {
    const rows = database.prepare(`
      SELECT
        configuration.stage_id,
        configuration.prompt,
        configuration.model,
        configuration.image_quality,
        configuration.updated_at,
        draft.prompt AS draft_prompt,
        draft.updated_at AS draft_updated_at
      FROM stage_configurations AS configuration
      LEFT JOIN prompt_drafts AS draft
        ON draft.stage_id = configuration.stage_id
    `).all() as unknown as StageRow[];
    const byStage = new Map(rows.map((row) => [row.stage_id, row]));

    return {
      stages: defaultStageConfigurations.map((definition): StageConfiguration => {
        const row = byStage.get(definition.id);
        if (!row) {
          throw new Error(`Stage Configuration ${definition.id} is missing`);
        }
        return {
          id: definition.id,
          name: definition.name,
          kind: definition.kind,
          prompt: row.prompt,
          model: row.model,
          imageQuality: row.image_quality,
          requiredInputs: [...definition.requiredInputs],
          outputContract: definition.outputContract,
          defaultConfiguration: {
            prompt: definition.prompt,
            model: definition.model,
            imageQuality: definition.imageQuality,
          },
          draftPrompt: row.draft_prompt && row.draft_updated_at
            ? { prompt: row.draft_prompt, updatedAt: row.draft_updated_at }
            : null,
          updatedAt: row.updated_at,
        };
      }),
    };
  }

  return {
    getWorkflowConfiguration() {
      return readWorkflowConfiguration();
    },

    savePromptDraft(stageId, prompt) {
      defaultStage(stageId);
      database.prepare(`
        INSERT INTO prompt_drafts (stage_id, prompt, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(stage_id) DO UPDATE SET
          prompt = excluded.prompt,
          updated_at = excluded.updated_at
      `).run(stageId, prompt, now().toISOString());
    },

    discardPromptDraft(stageId) {
      defaultStage(stageId);
      database.prepare('DELETE FROM prompt_drafts WHERE stage_id = ?')
        .run(stageId);
    },

    commitStageConfiguration(stageId, input) {
      validateCommit(stageId, input);
      const timestamp = now().toISOString();
      database.exec('BEGIN IMMEDIATE;');
      try {
        database.prepare(`
          UPDATE stage_configurations
          SET prompt = ?, model = ?, image_quality = ?, updated_at = ?
          WHERE stage_id = ?
        `).run(
          input.prompt.trim(),
          input.model.trim(),
          input.imageQuality,
          timestamp,
          stageId,
        );
        database.prepare('DELETE FROM prompt_drafts WHERE stage_id = ?')
          .run(stageId);
        database.exec('COMMIT;');
      } catch (error) {
        database.exec('ROLLBACK;');
        throw error;
      }
    },

    resetStageConfiguration(stageId) {
      replaceWithDefaults([stageId]);
    },

    resetWorkflowConfiguration() {
      replaceWithDefaults(defaultStageConfigurations.map(({ id }) => id));
    },

    exportWorkflowConfiguration() {
      return {
        schemaVersion: 1,
        stages: readWorkflowConfiguration().stages.map((stage) => ({
          id: stage.id,
          prompt: stage.prompt,
          model: stage.model,
          imageQuality: stage.imageQuality,
        })),
      };
    },

    importWorkflowConfiguration(input) {
      const stages = parseWorkflowConfigurationExport(input);
      for (const stage of stages) {
        validateCommit(stage.id, stage);
      }
      const timestamp = now().toISOString();
      const update = database.prepare(`
        UPDATE stage_configurations
        SET prompt = ?, model = ?, image_quality = ?, updated_at = ?
        WHERE stage_id = ?
      `);
      database.exec('BEGIN IMMEDIATE;');
      try {
        for (const stage of stages) {
          update.run(
            stage.prompt.trim(),
            stage.model.trim(),
            stage.imageQuality,
            timestamp,
            stage.id,
          );
        }
        database.exec('DELETE FROM prompt_drafts;');
        database.exec('COMMIT;');
      } catch (error) {
        database.exec('ROLLBACK;');
        throw error;
      }
    },

    close() {
      database.close();
    },
  };
}
