import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  ArtifactValidation,
  DesignBriefArtifact,
  DesignBriefGenerationResult,
  DesignBriefRun,
  ProjectWorkflow,
  TextGenerationBoundary,
  TokenUsage,
} from '../shared/generation.js';
import { GenerationBoundaryError } from './generation-boundary.js';
import { initializeStorage } from './storage.js';

export { GenerationBoundaryError } from './generation-boundary.js';

interface WorkflowServiceOptions {
  now?: () => Date;
  textGeneration: TextGenerationBoundary;
}

interface ProjectRow {
  id: string;
  insight_source: string;
}

interface ConfigurationRow {
  prompt: string;
  model: string;
  updated_at: string;
}

interface ArtifactRow {
  id: string;
  project_id: string;
  run_id: string;
  markdown: string;
  created_at: string;
  validation_json: string;
}

interface RunRow {
  id: string;
  project_id: string;
  status: DesignBriefRun['status'];
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  prompt_snapshot: string;
  model_snapshot: string;
  stage_configuration_updated_at: string;
  input_snapshot: string;
  assembled_request: string;
  response_id: string | null;
  request_id: string | null;
  usage_json: string | null;
  validation_json: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface WorkflowService {
  getProjectWorkflow(projectId: string): ProjectWorkflow;
  generateDesignBrief(projectId: string): Promise<ProjectWorkflow>;
  close(): void;
}

export class WorkflowProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} was not found`);
    this.name = 'WorkflowProjectNotFoundError';
  }
}

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

export class WorkflowGenerationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WorkflowGenerationError';
    this.code = code;
  }
}

function wordCount(markdown: string): number {
  return markdown.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function validateDesignBrief(markdown: string): ArtifactValidation {
  if (!markdown.trim()) {
    throw new WorkflowValidationError('OpenAI returned an empty Design Brief');
  }
  const words = wordCount(markdown);
  const warnings = words < 250
    ? [{
        code: 'below_recommended_word_count' as const,
        message: `Design Brief is ${words} words; the recommended minimum is 250.`,
      }]
    : [];
  return {
    status: warnings.length > 0 ? 'valid_with_warnings' : 'valid',
    wordCount: words,
    warnings,
  };
}

function readJson<T>(value: string | null): T | null {
  return value === null ? null : JSON.parse(value) as T;
}

function artifactFromRow(row: ArtifactRow | undefined): DesignBriefArtifact | null {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    stageId: 'design_brief',
    runId: row.run_id,
    markdown: row.markdown,
    createdAt: row.created_at,
    validation: JSON.parse(row.validation_json) as ArtifactValidation,
  };
}

function runFromRow(row: RunRow | undefined): DesignBriefRun | null {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    stageId: 'design_brief',
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    stagePrompt: row.prompt_snapshot,
    model: row.model_snapshot,
    stageConfigurationUpdatedAt: row.stage_configuration_updated_at,
    stageInput: {
      name: 'Insight Source',
      value: row.input_snapshot,
    },
    assembledRequest: row.assembled_request,
    responseId: row.response_id,
    requestId: row.request_id,
    usage: readJson<TokenUsage>(row.usage_json),
    validation: readJson<ArtifactValidation>(row.validation_json),
    error: row.error_code && row.error_message
      ? { code: row.error_code, message: row.error_message }
      : null,
  };
}

export async function openWorkflowService(
  dataDirectory: string,
  options: WorkflowServiceOptions,
): Promise<WorkflowService> {
  await initializeStorage(dataDirectory);
  const database = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
  database.exec('PRAGMA foreign_keys = ON;');
  const now = options.now ?? (() => new Date());

  function requireProject(projectId: string): ProjectRow {
    const project = database.prepare(`
      SELECT id, insight_source
      FROM projects
      WHERE id = ?
    `).get(projectId) as unknown as ProjectRow | undefined;
    if (!project) throw new WorkflowProjectNotFoundError(projectId);
    return project;
  }

  function designBriefConfiguration(): ConfigurationRow {
    const configuration = database.prepare(`
      SELECT prompt, model, updated_at
      FROM stage_configurations
      WHERE stage_id = 'design_brief'
    `).get() as unknown as ConfigurationRow | undefined;
    if (!configuration) {
      throw new Error('Design Brief Stage Configuration is missing');
    }
    return configuration;
  }

  function readProjectWorkflow(projectId: string): ProjectWorkflow {
    const project = requireProject(projectId);
    const configuration = designBriefConfiguration();
    const artifact = database.prepare(`
      SELECT artifact.id, artifact.project_id, artifact.run_id,
             artifact.markdown, artifact.created_at, artifact.validation_json
      FROM current_artifacts AS current
      JOIN artifacts AS artifact ON artifact.id = current.artifact_id
      WHERE current.project_id = ? AND current.stage_id = 'design_brief'
    `).get(projectId) as unknown as ArtifactRow | undefined;
    const lastRun = database.prepare(`
      SELECT *
      FROM stage_runs
      WHERE project_id = ? AND stage_id = 'design_brief'
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
    `).get(projectId) as unknown as RunRow | undefined;
    const hasInsight = project.insight_source.trim().length > 0;
    return {
      projectId,
      canGenerateDesignBrief: hasInsight,
      generationBlocker: hasInsight ? null : 'Add an Insight Source before generating a Design Brief.',
      designBrief: artifactFromRow(artifact),
      lastDesignBriefRun: runFromRow(lastRun),
      designBriefConfiguration: {
        model: configuration.model,
        promptUpdatedAt: configuration.updated_at,
      },
    };
  }

  return {
    getProjectWorkflow(projectId) {
      return readProjectWorkflow(projectId);
    },

    async generateDesignBrief(projectId) {
      const project = requireProject(projectId);
      if (!project.insight_source.trim()) {
        throw new WorkflowValidationError(
          'Add an Insight Source before generating a Design Brief.',
        );
      }
      const configuration = designBriefConfiguration();
      const runId = randomUUID();
      const startedAt = now();
      const assembledRequest = [
        'Stage Prompt:',
        configuration.prompt,
        '',
        'Stage Input — Insight Source:',
        project.insight_source,
      ].join('\n');
      database.prepare(`
        INSERT INTO stage_runs (
          id, project_id, stage_id, status, started_at,
          prompt_snapshot, model_snapshot, stage_configuration_updated_at,
          input_snapshot, assembled_request
        ) VALUES (?, ?, 'design_brief', 'running', ?, ?, ?, ?, ?, ?)
      `).run(
        runId,
        projectId,
        startedAt.toISOString(),
        configuration.prompt,
        configuration.model,
        configuration.updated_at,
        project.insight_source,
        assembledRequest,
      );

      let generated: DesignBriefGenerationResult;
      let validation: ArtifactValidation;
      try {
        generated = await options.textGeneration.generateDesignBrief({
          model: configuration.model,
          stagePrompt: configuration.prompt,
          insightSource: project.insight_source,
        });
        validation = validateDesignBrief(generated.markdown);
      } catch (error) {
        const completedAt = now();
        const boundaryError = error instanceof GenerationBoundaryError
          ? error
          : null;
        const code = boundaryError?.code
          ?? (error instanceof WorkflowValidationError
            ? 'invalid_artifact'
            : 'generation_failed');
        const message = boundaryError?.message
          ?? (error instanceof WorkflowValidationError
            ? error.message
            : 'Design Brief generation failed.');
        database.prepare(`
          UPDATE stage_runs
          SET status = 'failed', completed_at = ?, duration_ms = ?,
              response_id = ?, request_id = ?, error_code = ?, error_message = ?
          WHERE id = ?
        `).run(
          completedAt.toISOString(),
          Math.max(0, completedAt.getTime() - startedAt.getTime()),
          boundaryError?.responseId ?? null,
          boundaryError?.requestId ?? null,
          code,
          message,
          runId,
        );
        throw new WorkflowGenerationError(code, message);
      }
      const completedAt = now();
      const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
      const artifactId = randomUUID();

      database.exec('BEGIN IMMEDIATE;');
      try {
        database.prepare(`
          UPDATE stage_runs
          SET status = 'succeeded', completed_at = ?, duration_ms = ?,
              response_id = ?, request_id = ?, usage_json = ?, validation_json = ?
          WHERE id = ?
        `).run(
          completedAt.toISOString(),
          durationMs,
          generated.responseId,
          generated.requestId,
          JSON.stringify(generated.usage),
          JSON.stringify(validation),
          runId,
        );
        database.prepare(`
          INSERT INTO artifacts (
            id, project_id, stage_id, run_id, markdown, created_at, validation_json
          ) VALUES (?, ?, 'design_brief', ?, ?, ?, ?)
        `).run(
          artifactId,
          projectId,
          runId,
          generated.markdown.trim(),
          completedAt.toISOString(),
          JSON.stringify(validation),
        );
        database.prepare(`
          INSERT INTO current_artifacts (project_id, stage_id, artifact_id)
          VALUES (?, 'design_brief', ?)
          ON CONFLICT(project_id, stage_id) DO UPDATE SET
            artifact_id = excluded.artifact_id
        `).run(projectId, artifactId);
        database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
          .run(completedAt.toISOString(), projectId);
        database.exec('COMMIT;');
      } catch (error) {
        database.exec('ROLLBACK;');
        throw error;
      }

      return readProjectWorkflow(projectId);
    },

    close() {
      database.close();
    },
  };
}
