import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import type {
  ArtifactValidation,
  ConceptScreenOperation,
  ConceptScreenOrdinal,
  ConceptScreenRun,
  ConceptScreenSetArtifact,
  ConceptScreenValidation,
  DesignBriefArtifact,
  DesignBriefGenerationResult,
  DesignBriefRun,
  ProjectWorkflow,
  TextGenerationBoundary,
  TokenUsage,
} from '../shared/generation.js';
import type { ImageQuality } from '../shared/workflow-configuration.js';
import { GenerationBoundaryError } from './generation-boundary.js';
import type { ImageGenerationBoundary } from './image-generation-boundary.js';
import { initializeStorage } from './storage.js';

export { GenerationBoundaryError } from './generation-boundary.js';

interface WorkflowServiceOptions {
  imageGeneration?: ImageGenerationBoundary;
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
  image_quality: ImageQuality | null;
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
  settings_json: string | null;
  response_id: string | null;
  request_id: string | null;
  usage_json: string | null;
  validation_json: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface ConceptArtifactRow {
  id: string;
  project_id: string;
  run_id: string;
  created_at: string;
  validation_json: string;
}

interface ConceptOperationRow {
  ordinal: ConceptScreenOrdinal;
  status: 'running' | 'succeeded' | 'failed';
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  asset_id: string | null;
  response_id: string | null;
  request_id: string | null;
  usage_json: string | null;
  error_code: string | null;
  error_message: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  relative_path: string | null;
}

export interface WorkflowService {
  getProjectWorkflow(projectId: string): ProjectWorkflow;
  getConceptScreenAsset(projectId: string, assetId: string): Buffer;
  generateDesignBrief(projectId: string): Promise<ProjectWorkflow>;
  generateConceptScreens(projectId: string): Promise<ProjectWorkflow>;
  cancelConceptScreens(projectId: string): boolean;
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

class WorkflowCancellationError extends Error {
  constructor() {
    super('Concept Screen generation was cancelled.');
    this.name = 'WorkflowCancellationError';
  }
}

function addUsage(total: TokenUsage, usage: TokenUsage): TokenUsage {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
  };
}

function validateConceptScreenPng(png: Buffer): { width: number; height: number } {
  let decoded: PNG;
  try {
    decoded = PNG.sync.read(png, { checkCRC: true });
  } catch {
    throw new WorkflowValidationError('OpenAI returned an invalid Concept Screen PNG.');
  }
  if (decoded.width < 1 || decoded.height < 1) {
    throw new WorkflowValidationError('OpenAI returned a Concept Screen with invalid dimensions.');
  }
  return { width: decoded.width, height: decoded.height };
}

function validateConceptScreenSet(
  operations: ConceptOperationRow[],
): ConceptScreenValidation {
  const completed = operations.filter((operation) => operation.status === 'succeeded');
  if (completed.length !== 3 || completed.some(({ asset_id }) => !asset_id)) {
    throw new WorkflowValidationError('A Concept Screen Set requires exactly three PNGs.');
  }
  const [{ width, height }] = completed;
  if (!width || !height || completed.some((screen) =>
    screen.width !== width || screen.height !== height)) {
    throw new WorkflowValidationError('All Concept Screens must use identical dimensions.');
  }
  const warnings = width < 800 || height < 600
    ? [{
        code: 'undersized_concept_screens' as const,
        message: `Concept Screens are ${width}×${height}; inspect whether they contain enough visual detail.`,
      }]
    : [];
  return {
    status: warnings.length > 0 ? 'valid_with_warnings' : 'valid',
    screenCount: 3,
    width,
    height,
    warnings,
  };
}

function conceptOperationFromRow(row: ConceptOperationRow): ConceptScreenOperation {
  const status = row.status;
  return {
    ordinal: row.ordinal,
    status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    requestId: row.request_id,
    responseId: row.response_id,
    usage: readJson<TokenUsage>(row.usage_json),
    error: row.error_code && row.error_message
      ? { code: row.error_code, message: row.error_message }
      : null,
  };
}

function conceptRunFromRows(
  row: RunRow | undefined,
  operations: ConceptOperationRow[],
): ConceptScreenRun | null {
  if (!row) return null;
  const settings = readJson<{ imageQuality: ImageQuality }>(row.settings_json);
  const derivedStatus = row.status === 'failed' && row.error_code === 'cancelled'
    ? 'cancelled'
    : row.status;
  return {
    id: row.id,
    projectId: row.project_id,
    stageId: 'concept_screens',
    status: derivedStatus,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    stagePrompt: row.prompt_snapshot,
    model: row.model_snapshot,
    imageQuality: settings?.imageQuality ?? 'medium',
    stageConfigurationUpdatedAt: row.stage_configuration_updated_at,
    stageInput: { name: 'Design Brief', value: row.input_snapshot },
    assembledRequest: row.assembled_request,
    completedOperationCount: operations.filter(({ status }) => status === 'succeeded').length,
    operations: operations.map(conceptOperationFromRow),
    usage: readJson<TokenUsage>(row.usage_json),
    validation: readJson<ConceptScreenValidation>(row.validation_json),
    error: row.error_code && row.error_message
      ? { code: row.error_code, message: row.error_message }
      : null,
  };
}

function conceptArtifactFromRows(
  row: ConceptArtifactRow | undefined,
  operations: ConceptOperationRow[],
): ConceptScreenSetArtifact | null {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    stageId: 'concept_screens',
    runId: row.run_id,
    createdAt: row.created_at,
    validation: JSON.parse(row.validation_json) as ConceptScreenValidation,
    screens: operations.filter((operation) => operation.status === 'succeeded')
      .map((operation) => ({
        assetId: operation.asset_id!,
        ordinal: operation.ordinal,
        width: operation.width!,
        height: operation.height!,
        byteSize: operation.byte_size!,
        mediaType: 'image/png' as const,
        downloadUrl: `/api/projects/${row.project_id}/concept-screen-assets/${operation.asset_id}`,
        requestId: operation.request_id,
        responseId: operation.response_id,
        usage: readJson<TokenUsage>(operation.usage_json) ?? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      })),
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
  const imageGeneration = options.imageGeneration ?? {
    async generateConceptScreen() {
      throw new GenerationBoundaryError(
        'image_generation_unavailable',
        'Concept Screen generation is not configured.',
      );
    },
  } satisfies ImageGenerationBoundary;
  const activeConceptRuns = new Map<string, {
    runId: string;
    cancelRequested: boolean;
  }>();

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
      SELECT prompt, model, image_quality, updated_at
      FROM stage_configurations
      WHERE stage_id = 'design_brief'
    `).get() as unknown as ConfigurationRow | undefined;
    if (!configuration) {
      throw new Error('Design Brief Stage Configuration is missing');
    }
    return configuration;
  }

  function conceptScreenConfiguration(): ConfigurationRow & { image_quality: ImageQuality } {
    const configuration = database.prepare(`
      SELECT prompt, model, image_quality, updated_at
      FROM stage_configurations
      WHERE stage_id = 'concept_screens'
    `).get() as unknown as ConfigurationRow | undefined;
    if (!configuration?.image_quality) {
      throw new Error('Concept Screens Stage Configuration is missing');
    }
    return configuration as ConfigurationRow & { image_quality: ImageQuality };
  }

  function conceptOperations(runId: string): ConceptOperationRow[] {
    return database.prepare(`
      SELECT operation.*, asset.width, asset.height, asset.byte_size,
             asset.relative_path
      FROM concept_screen_operations AS operation
      LEFT JOIN binary_assets AS asset ON asset.id = operation.asset_id
      WHERE operation.run_id = ?
      ORDER BY operation.ordinal
    `).all(runId) as unknown as ConceptOperationRow[];
  }

  function readProjectWorkflow(projectId: string): ProjectWorkflow {
    const project = requireProject(projectId);
    const configuration = designBriefConfiguration();
    const imageConfiguration = conceptScreenConfiguration();
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
    const conceptArtifact = database.prepare(`
      SELECT artifact.id, artifact.project_id, artifact.run_id,
             artifact.created_at, artifact.validation_json
      FROM current_artifacts AS current
      JOIN artifacts AS artifact ON artifact.id = current.artifact_id
      WHERE current.project_id = ? AND current.stage_id = 'concept_screens'
    `).get(projectId) as unknown as ConceptArtifactRow | undefined;
    const lastConceptRun = database.prepare(`
      SELECT *
      FROM stage_runs
      WHERE project_id = ? AND stage_id = 'concept_screens'
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
    `).get(projectId) as unknown as RunRow | undefined;
    const lastConceptOperations = lastConceptRun
      ? conceptOperations(lastConceptRun.id)
      : [];
    const currentConceptOperations = conceptArtifact
      ? conceptOperations(conceptArtifact.run_id)
      : [];
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
      canGenerateConceptScreens: Boolean(artifact),
      conceptScreenGenerationBlocker: artifact
        ? null
        : 'Generate a Design Brief before generating Concept Screens.',
      conceptScreenSet: conceptArtifactFromRows(
        conceptArtifact,
        currentConceptOperations,
      ),
      lastConceptScreenRun: conceptRunFromRows(
        lastConceptRun,
        lastConceptOperations,
      ),
      conceptScreenConfiguration: {
        model: imageConfiguration.model,
        imageQuality: imageConfiguration.image_quality,
        promptUpdatedAt: imageConfiguration.updated_at,
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

    getConceptScreenAsset(projectId, assetId) {
      requireProject(projectId);
      const asset = database.prepare(`
        SELECT relative_path
        FROM binary_assets
        WHERE id = ? AND project_id = ?
      `).get(assetId, projectId) as unknown as { relative_path: string } | undefined;
      if (!asset) throw new WorkflowProjectNotFoundError(assetId);
      return readFileSync(join(dataDirectory, asset.relative_path));
    },

    async generateConceptScreens(projectId) {
      requireProject(projectId);
      if (activeConceptRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'Concept Screen generation is already running for this Project.',
        );
      }
      const designBrief = database.prepare(`
        SELECT artifact.markdown
        FROM current_artifacts AS current
        JOIN artifacts AS artifact ON artifact.id = current.artifact_id
        WHERE current.project_id = ? AND current.stage_id = 'design_brief'
      `).get(projectId) as unknown as { markdown: string } | undefined;
      if (!designBrief) {
        throw new WorkflowValidationError(
          'Generate a Design Brief before generating Concept Screens.',
        );
      }
      const configuration = conceptScreenConfiguration();
      const assembledRequest = [
        'Stage Prompt:',
        configuration.prompt,
        '',
        'Stage Input — Design Brief:',
        designBrief.markdown,
      ].join('\n');
      const settingsJson = JSON.stringify({ imageQuality: configuration.image_quality });
      const resumableRun = database.prepare(`
        SELECT *
        FROM stage_runs
        WHERE project_id = ? AND stage_id = 'concept_screens'
          AND status = 'failed'
          AND prompt_snapshot = ? AND model_snapshot = ?
          AND stage_configuration_updated_at = ?
          AND input_snapshot = ? AND settings_json = ?
        ORDER BY started_at DESC, rowid DESC
        LIMIT 1
      `).get(
        projectId,
        configuration.prompt,
        configuration.model,
        configuration.updated_at,
        designBrief.markdown,
        settingsJson,
      ) as unknown as RunRow | undefined;
      const runId = resumableRun?.id ?? randomUUID();
      const runStartedAt = resumableRun
        ? new Date(resumableRun.started_at)
        : now();
      const attemptStartedAt = now();
      const priorDurationMs = resumableRun?.duration_ms ?? 0;
      if (resumableRun) {
        database.prepare(`
          UPDATE stage_runs
          SET status = 'running', completed_at = NULL, duration_ms = ?,
              validation_json = NULL, error_code = NULL, error_message = NULL
          WHERE id = ?
        `).run(priorDurationMs, runId);
      } else {
        database.prepare(`
          INSERT INTO stage_runs (
            id, project_id, stage_id, status, started_at,
            prompt_snapshot, model_snapshot, stage_configuration_updated_at,
            input_snapshot, assembled_request, settings_json
          ) VALUES (?, ?, 'concept_screens', 'running', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          runId,
          projectId,
          runStartedAt.toISOString(),
          configuration.prompt,
          configuration.model,
          configuration.updated_at,
          designBrief.markdown,
          assembledRequest,
          settingsJson,
        );
      }
      const completed: Array<{
        ordinal: ConceptScreenOrdinal;
        assetId: string;
        png: Buffer;
        width: number;
        height: number;
      }> = conceptOperations(runId)
        .filter((operation) => operation.status === 'succeeded')
        .map((operation) => ({
          ordinal: operation.ordinal,
          assetId: operation.asset_id!,
          png: readFileSync(join(dataDirectory, operation.relative_path!)),
          width: operation.width!,
          height: operation.height!,
        }));
      let totalUsage: TokenUsage = conceptOperations(runId)
        .filter((operation) => operation.status === 'succeeded')
        .reduce((total, operation) => addUsage(
          total,
          readJson<TokenUsage>(operation.usage_json) ?? {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
        ), {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
      activeConceptRuns.set(projectId, { runId, cancelRequested: false });
      let activeOperationIdentifiers: {
        requestId: string | null;
        responseId: string | null;
      } | null = null;

      try {
        for (const ordinal of [1, 2, 3] as const) {
          if (completed.some((screen) => screen.ordinal === ordinal)) continue;
          if (activeConceptRuns.get(projectId)?.cancelRequested) {
            throw new WorkflowCancellationError();
          }
          const operationStartedAt = now();
          database.prepare(`
            INSERT INTO concept_screen_operations (
              run_id, ordinal, status, started_at
            ) VALUES (?, ?, 'running', ?)
            ON CONFLICT(run_id, ordinal) DO UPDATE SET
              status = 'running', started_at = excluded.started_at,
              completed_at = NULL, duration_ms = NULL, asset_id = NULL,
              response_id = NULL, request_id = NULL, usage_json = NULL,
              error_code = NULL, error_message = NULL
          `).run(runId, ordinal, operationStartedAt.toISOString());

          const first = completed[0];
          const generated = await imageGeneration.generateConceptScreen({
            model: configuration.model,
            quality: configuration.image_quality,
            stagePrompt: configuration.prompt,
            designBrief: designBrief.markdown,
            ordinal,
            references: completed.map((screen) => ({
              ordinal: screen.ordinal,
              png: screen.png,
            })),
            size: first ? `${first.width}x${first.height}` : 'auto',
          });
          activeOperationIdentifiers = {
            requestId: generated.requestId,
            responseId: generated.responseId,
          };
          const dimensions = validateConceptScreenPng(generated.png);
          if (first && (
            dimensions.width !== first.width || dimensions.height !== first.height
          )) {
            throw new WorkflowValidationError(
              `Concept Screen ${ordinal} dimensions do not match Concept Screen 1.`,
            );
          }
          const operationCompletedAt = now();
          const assetId = randomUUID();
          const relativePath = join('assets', `${assetId}.png`);
          await writeFile(join(dataDirectory, relativePath), generated.png);
          database.exec('BEGIN IMMEDIATE;');
          try {
            database.prepare(`
              INSERT INTO binary_assets (
                id, project_id, run_id, relative_path, media_type,
                byte_size, width, height, created_at
              ) VALUES (?, ?, ?, ?, 'image/png', ?, ?, ?, ?)
            `).run(
              assetId,
              projectId,
              runId,
              relativePath,
              generated.png.byteLength,
              dimensions.width,
              dimensions.height,
              operationCompletedAt.toISOString(),
            );
            database.prepare(`
              UPDATE concept_screen_operations
              SET status = 'succeeded', completed_at = ?, duration_ms = ?,
                  asset_id = ?, response_id = ?, request_id = ?, usage_json = ?,
                  error_code = NULL, error_message = NULL
              WHERE run_id = ? AND ordinal = ?
            `).run(
              operationCompletedAt.toISOString(),
              Math.max(0, operationCompletedAt.getTime() - operationStartedAt.getTime()),
              assetId,
              generated.responseId,
              generated.requestId,
              JSON.stringify(generated.usage),
              runId,
              ordinal,
            );
            database.exec('COMMIT;');
          } catch (error) {
            database.exec('ROLLBACK;');
            throw error;
          }
          totalUsage = addUsage(totalUsage, generated.usage);
          completed.push({ ordinal, assetId, png: generated.png, ...dimensions });
          activeOperationIdentifiers = null;
        }

        const operations = conceptOperations(runId);
        const validation = validateConceptScreenSet(operations);
        const completedAt = now();
        const artifactId = randomUUID();
        database.exec('BEGIN IMMEDIATE;');
        try {
          database.prepare(`
            UPDATE stage_runs
            SET status = 'succeeded', completed_at = ?, duration_ms = ?,
                usage_json = ?, validation_json = ?,
                error_code = NULL, error_message = NULL
            WHERE id = ?
          `).run(
            completedAt.toISOString(),
            priorDurationMs + Math.max(
              0,
              completedAt.getTime() - attemptStartedAt.getTime(),
            ),
            JSON.stringify(totalUsage),
            JSON.stringify(validation),
            runId,
          );
          database.prepare(`
            INSERT INTO artifacts (
              id, project_id, stage_id, run_id, markdown, created_at, validation_json
            ) VALUES (?, ?, 'concept_screens', ?, '', ?, ?)
          `).run(
            artifactId,
            projectId,
            runId,
            completedAt.toISOString(),
            JSON.stringify(validation),
          );
          database.prepare(`
            INSERT INTO current_artifacts (project_id, stage_id, artifact_id)
            VALUES (?, 'concept_screens', ?)
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
      } catch (error) {
        const completedAt = now();
        const boundaryError = error instanceof GenerationBoundaryError ? error : null;
        const validationError = error instanceof WorkflowValidationError ? error : null;
        const cancellationError = error instanceof WorkflowCancellationError ? error : null;
        const code = cancellationError
          ? 'cancelled'
          : boundaryError?.code
          ?? (validationError ? 'invalid_artifact' : 'generation_failed');
        const message = cancellationError?.message
          ?? boundaryError?.message
          ?? validationError?.message
          ?? 'Concept Screen generation failed.';
        database.prepare(`
          UPDATE concept_screen_operations
          SET status = 'failed', completed_at = ?,
              duration_ms = MAX(0, unixepoch(?) * 1000 - unixepoch(started_at) * 1000),
              request_id = COALESCE(?, request_id),
              response_id = COALESCE(?, response_id),
              error_code = ?, error_message = ?
          WHERE run_id = ? AND status = 'running'
        `).run(
          completedAt.toISOString(),
          completedAt.toISOString(),
          boundaryError?.requestId ?? activeOperationIdentifiers?.requestId ?? null,
          boundaryError?.responseId ?? activeOperationIdentifiers?.responseId ?? null,
          code,
          message,
          runId,
        );
        database.prepare(`
          UPDATE stage_runs
          SET status = 'failed', completed_at = ?, duration_ms = ?,
              usage_json = ?, error_code = ?, error_message = ?
          WHERE id = ?
        `).run(
          completedAt.toISOString(),
          priorDurationMs + Math.max(
            0,
            completedAt.getTime() - attemptStartedAt.getTime(),
          ),
          JSON.stringify(totalUsage),
          code,
          message,
          runId,
        );
        activeConceptRuns.delete(projectId);
        throw new WorkflowGenerationError(code, message);
      }

      activeConceptRuns.delete(projectId);
      return readProjectWorkflow(projectId);
    },

    cancelConceptScreens(projectId) {
      requireProject(projectId);
      const active = activeConceptRuns.get(projectId);
      if (!active) return false;
      active.cancelRequested = true;
      return true;
    },

    close() {
      database.close();
    },
  };
}
