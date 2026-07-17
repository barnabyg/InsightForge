import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { strToU8, zipSync } from 'fflate';
import { PNG } from 'pngjs';
import {
  generatedStageIds,
  generatedStageNames,
} from '../shared/generation.js';
import type {
  ArtifactValidation,
  CandidateWarning,
  CandidateWorkflow,
  ConceptScreenOperation,
  ConceptScreenOrdinal,
  ConceptScreenProgressEvent,
  ConceptScreenAttemptHistory,
  ConceptScreenRun,
  ConceptScreenSetArtifact,
  ConceptScreenValidation,
  DesignBriefArtifact,
  DesignBriefGenerationResult,
  DesignBriefRun,
  FullGenerationProgressEvent,
  GeneratedStageId,
  InsightRevision,
  PrdArtifact,
  PrdGenerationResult,
  PrdRun,
  ProjectWorkflow,
  RunKind,
  TextGenerationBoundary,
  TokenUsage,
  WorkflowSnapshotSummary,
} from '../shared/generation.js';
import type { ImageQuality, StageId } from '../shared/workflow-configuration.js';
import { GenerationBoundaryError } from './generation-boundary.js';
import type { ImageGenerationBoundary } from './image-generation-boundary.js';
import { initializeStorage } from './storage.js';
import {
  buildPrdStageInput,
  readWorkflowRerunPlan,
  storedRunFingerprint,
  workflowFingerprint,
} from './workflow-update-analysis.js';

export { GenerationBoundaryError } from './generation-boundary.js';

interface WorkflowServiceOptions {
  imageGeneration?: ImageGenerationBoundary;
  now?: () => Date;
  textGeneration: TextGenerationBoundary;
}

interface ProjectRow {
  id: string;
  name: string;
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
  run_kind: RunKind;
  status: DesignBriefRun['status'];
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  prompt_snapshot: string;
  model_snapshot: string;
  stage_configuration_updated_at: string;
  input_snapshot: string;
  input_artifact_id: string | null;
  input_run_id: string | null;
  input_lineage_json: string | null;
  assembled_request: string;
  settings_json: string | null;
  attempt_history_json: string | null;
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

interface CandidateRow {
  id: string;
  project_id: string;
  run_kind: RunKind;
  status: CandidateWorkflow['status'];
  current_stage: CandidateWorkflow['currentStage'];
  completed_operation_count: number;
  insight_source: string;
  insight_revision_id: string | null;
  configuration_json: string;
  design_brief_run_id: string | null;
  design_brief_artifact_id: string | null;
  concept_screen_run_id: string | null;
  concept_screen_artifact_id: string | null;
  prd_run_id: string | null;
  prd_artifact_id: string | null;
  warnings_json: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  updated_at: string;
  start_stage: GeneratedStageId;
}

interface InsightRevisionRow {
  id: string;
  project_id: string;
  insight_source: string;
  created_at: string;
  updated_at: string;
}

interface WorkflowSnapshotRow {
  id: string;
  created_at: string;
  replaced_from_stage: GeneratedStageId;
  design_brief_artifact_id: string;
  concept_screen_artifact_id: string;
  prd_artifact_id: string;
}

interface CandidateConfigurations {
  designBrief: ConfigurationRow;
  conceptScreens: ConfigurationRow & { image_quality: ImageQuality };
  prd: ConfigurationRow;
}

export interface WorkflowService {
  getProjectWorkflow(projectId: string): ProjectWorkflow;
  getConceptScreenAsset(projectId: string, assetId: string): Buffer;
  exportDeliverables(projectId: string): DeliverableExport;
  generateDesignBrief(projectId: string, candidateId?: string): Promise<ProjectWorkflow>;
  generateConceptScreens(projectId: string, candidateId?: string): Promise<ProjectWorkflow>;
  generatePrd(projectId: string, candidateId?: string): Promise<ProjectWorkflow>;
  generateFullWorkflow(projectId: string): Promise<ProjectWorkflow>;
  regenerateWorkflow(
    projectId: string,
    startStage: GeneratedStageId,
  ): Promise<ProjectWorkflow>;
  beginInsightRevision(projectId: string): ProjectWorkflow;
  updateInsightRevision(projectId: string, insightSource: string): ProjectWorkflow;
  generateInsightRevision(projectId: string): Promise<ProjectWorkflow>;
  discardInsightRevision(projectId: string): ProjectWorkflow;
  resumeFullWorkflow(projectId: string): Promise<ProjectWorkflow>;
  promoteFullWorkflow(projectId: string): ProjectWorkflow;
  keepCandidateAfterWarningReview(projectId: string): ProjectWorkflow;
  discardFullWorkflow(projectId: string): Promise<ProjectWorkflow>;
  cancelFullWorkflow(projectId: string): boolean;
  cancelConceptScreens(projectId: string): boolean;
  subscribeConceptScreenProgress(
    projectId: string,
    listener: (event: ConceptScreenProgressEvent) => void,
  ): () => void;
  subscribeFullGenerationProgress(
    projectId: string,
    listener: (event: FullGenerationProgressEvent) => void,
  ): () => void;
  close(): void;
}

export interface DeliverableExport {
  fileName: string;
  bytes: Buffer;
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

function validateMarkdownArtifact(
  markdown: string,
  artifactName: 'Design Brief' | 'PRD',
): ArtifactValidation {
  if (!markdown.trim()) {
    throw new WorkflowValidationError(`OpenAI returned an empty ${artifactName}`);
  }
  const words = wordCount(markdown);
  const warnings = words < 250
    ? [{
        code: 'below_recommended_word_count' as const,
        message: `${artifactName} is ${words} words; the recommended minimum is 250.`,
      }]
    : [];
  return {
    status: warnings.length > 0 ? 'valid_with_warnings' : 'valid',
    wordCount: words,
    warnings,
  };
}

function fileNameSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'project';
}

function validateDesignBrief(markdown: string): ArtifactValidation {
  return validateMarkdownArtifact(markdown, 'Design Brief');
}

function readJson<T>(value: string | null): T | null {
  return value === null ? null : JSON.parse(value) as T;
}

function candidateFromRow(row: CandidateRow | undefined): CandidateWorkflow | null {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    runKind: row.run_kind,
    status: row.status,
    currentStage: row.current_stage,
    completedOperationCount: row.completed_operation_count,
    totalOperationCount: 5,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    warnings: readJson<CandidateWarning[]>(row.warnings_json) ?? [],
    error: row.error_code && row.error_message
      ? { code: row.error_code, message: row.error_message }
      : null,
  };
}

function insightRevisionFromRow(
  row: InsightRevisionRow | undefined,
): InsightRevision | null {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    insightSource: row.insight_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    runKind: row.run_kind,
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

function prdArtifactFromRow(row: ArtifactRow | undefined): PrdArtifact | null {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    stageId: 'prd',
    runId: row.run_id,
    markdown: row.markdown,
    createdAt: row.created_at,
    validation: JSON.parse(row.validation_json) as ArtifactValidation,
  };
}

function prdRunFromRow(row: RunRow | undefined): PrdRun | null {
  if (!row) return null;
  const lineage = readJson<PrdRun['stageInput']>(row.input_lineage_json);
  if (!lineage) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    stageId: 'prd',
    runKind: row.run_kind,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    stagePrompt: row.prompt_snapshot,
    model: row.model_snapshot,
    stageConfigurationUpdatedAt: row.stage_configuration_updated_at,
    stageInput: lineage,
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
    runKind: row.run_kind,
    status: derivedStatus,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    stagePrompt: row.prompt_snapshot,
    model: row.model_snapshot,
    imageQuality: settings?.imageQuality ?? 'medium',
    stageConfigurationUpdatedAt: row.stage_configuration_updated_at,
    stageInput: {
      name: 'Design Brief',
      value: row.input_snapshot,
      artifactId: row.input_artifact_id,
      runId: row.input_run_id,
    },
    assembledRequest: row.assembled_request,
    completedOperationCount: operations.filter(({ status }) => status === 'succeeded').length,
    operations: operations.map(conceptOperationFromRow),
    attemptHistory: readJson<ConceptScreenAttemptHistory[]>(row.attempt_history_json) ?? [],
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
  const hasInterruptedCandidate = Boolean(database.prepare(`
    SELECT 1 FROM workflow_candidates WHERE status = 'running' LIMIT 1
  `).get());
  if (hasInterruptedCandidate) {
    const recoveredAt = now().toISOString();
    database.prepare(`
    UPDATE concept_screen_operations
    SET status = 'failed', completed_at = ?, error_code = 'generation_interrupted',
        error_message = 'Generation was interrupted before this operation completed.'
    WHERE status = 'running'
      AND run_id IN (
        SELECT concept_screen_run_id FROM workflow_candidates WHERE status = 'running'
      )
    `).run(recoveredAt);
    database.prepare(`
    UPDATE stage_runs
    SET status = 'failed', completed_at = ?, error_code = 'generation_interrupted',
        error_message = 'Generation was interrupted before this Stage Run completed.'
    WHERE status = 'running' AND id IN (
      SELECT design_brief_run_id FROM workflow_candidates WHERE status = 'running'
      UNION SELECT concept_screen_run_id FROM workflow_candidates WHERE status = 'running'
      UNION SELECT prd_run_id FROM workflow_candidates WHERE status = 'running'
    )
    `).run(recoveredAt);
    database.prepare(`
    UPDATE workflow_candidates
    SET status = 'failed', error_code = 'generation_interrupted',
        error_message = 'Full Generation was interrupted and can be resumed.',
        updated_at = ?
    WHERE status = 'running'
    `).run(recoveredAt);
  }
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
  const activeDesignBriefRuns = new Set<string>();
  const activePrdRuns = new Set<string>();
  const activeFullRuns = new Map<string, {
    candidateId: string;
    cancelRequested: boolean;
  }>();
  const conceptProgressListeners = new Map<
    string,
    Set<(event: ConceptScreenProgressEvent) => void>
  >();
  const fullProgressListeners = new Map<
    string,
    Set<(event: FullGenerationProgressEvent) => void>
  >();
  function emitConceptProgress(event: ConceptScreenProgressEvent): void {
    for (const listener of conceptProgressListeners.get(event.projectId) ?? []) {
      try {
        listener(event);
      } catch {
        // A disconnected observer must never interrupt an atomic Stage Run.
      }
    }
  }

  function requireProject(projectId: string): ProjectRow {
    const project = database.prepare(`
      SELECT id, name, insight_source
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

  function emitFullProgress(event: FullGenerationProgressEvent): void {
    for (const listener of fullProgressListeners.get(event.projectId) ?? []) {
      try {
        listener(event);
      } catch {
        // A disconnected observer must never interrupt an atomic Candidate Workflow.
      }
    }
  }

  function prdConfiguration(): ConfigurationRow {
    const configuration = database.prepare(`
      SELECT prompt, model, image_quality, updated_at
      FROM stage_configurations
      WHERE stage_id = 'prd'
    `).get() as unknown as ConfigurationRow | undefined;
    if (!configuration) {
      throw new Error('PRD Stage Configuration is missing');
    }
    return configuration;
  }

  function candidateRow(projectId: string): CandidateRow | undefined {
    return database.prepare(`
      SELECT * FROM workflow_candidates WHERE project_id = ?
    `).get(projectId) as unknown as CandidateRow | undefined;
  }

  function insightRevisionRow(projectId: string): InsightRevisionRow | undefined {
    return database.prepare(`
      SELECT id, project_id, insight_source, created_at, updated_at
      FROM insight_revisions
      WHERE project_id = ?
    `).get(projectId) as unknown as InsightRevisionRow | undefined;
  }

  function requireCandidate(projectId: string, candidateId?: string): CandidateRow {
    const candidate = candidateRow(projectId);
    if (!candidate || (candidateId && candidate.id !== candidateId)) {
      throw new WorkflowValidationError('No matching Candidate Workflow is available.');
    }
    return candidate;
  }

  function candidateConfigurations(candidate: CandidateRow): CandidateConfigurations {
    return JSON.parse(candidate.configuration_json) as CandidateConfigurations;
  }

  function assertGenerationAvailable(projectId: string, candidateId?: string): void {
    const fullRun = activeFullRuns.get(projectId);
    if (fullRun && fullRun.candidateId !== candidateId) {
      throw new WorkflowValidationError(
        'Full Generation is already running for this Project.',
      );
    }
    const candidate = candidateRow(projectId);
    if (candidate && candidate.id !== candidateId) {
      throw new WorkflowValidationError(
        'Resume or discard the existing Candidate Workflow first.',
      );
    }
  }

  function updateCandidate(
    candidateId: string,
    values: {
      status?: CandidateWorkflow['status'];
      currentStage?: CandidateWorkflow['currentStage'];
      completedOperationCount?: number;
      warnings?: CandidateWarning[];
      error?: { code: string; message: string } | null;
    },
  ): void {
    const updatedAt = now().toISOString();
    database.prepare(`
      UPDATE workflow_candidates
      SET status = COALESCE(?, status),
          current_stage = COALESCE(?, current_stage),
          completed_operation_count = COALESCE(?, completed_operation_count),
          warnings_json = CASE WHEN ? IS NULL THEN warnings_json ELSE ? END,
          error_code = CASE WHEN ? = 0 THEN error_code ELSE ? END,
          error_message = CASE WHEN ? = 0 THEN error_message ELSE ? END,
          updated_at = ?
      WHERE id = ?
    `).run(
      values.status ?? null,
      values.currentStage ?? null,
      values.completedOperationCount ?? null,
      values.warnings === undefined ? null : 1,
      values.warnings === undefined ? null : JSON.stringify(values.warnings),
      values.error === undefined ? 0 : 1,
      values.error?.code ?? null,
      values.error === undefined ? 0 : 1,
      values.error?.message ?? null,
      updatedAt,
      candidateId,
    );
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

  function pendingDesignBriefCandidate(projectId: string): {
    id: string;
    run_id: string;
    markdown: string;
  } | undefined {
    return database.prepare(`
      SELECT artifact.id, artifact.run_id, artifact.markdown
      FROM pending_cascades AS pending
      JOIN artifacts AS artifact ON artifact.id = pending.design_brief_artifact_id
      WHERE pending.project_id = ?
    `).get(projectId) as unknown as {
      id: string;
      run_id: string;
      markdown: string;
    } | undefined;
  }

  function hasCurrentWorkflow(projectId: string): boolean {
    return Boolean(database.prepare(`
      SELECT 1
      FROM current_artifacts
      WHERE project_id = ?
      LIMIT 1
    `).get(projectId));
  }

  function hasCurrentPrd(projectId: string): boolean {
    return Boolean(database.prepare(`
      SELECT 1
      FROM current_artifacts
      WHERE project_id = ? AND stage_id = 'prd'
    `).get(projectId));
  }

  function currentArtifact(projectId: string, stageId: StageId): ArtifactRow | undefined {
    return database.prepare(`
      SELECT artifact.id, artifact.project_id, artifact.run_id,
             artifact.markdown, artifact.created_at, artifact.validation_json
      FROM current_artifacts AS current
      JOIN artifacts AS artifact ON artifact.id = current.artifact_id
      WHERE current.project_id = ? AND current.stage_id = ?
    `).get(projectId, stageId) as unknown as ArtifactRow | undefined;
  }

  function stageRun(runId: string): RunRow | undefined {
    return database.prepare(
      'SELECT * FROM stage_runs WHERE id = ?',
    ).get(runId) as unknown as RunRow | undefined;
  }

  function classifyStageRun(
    projectId: string,
    stageId: GeneratedStageId,
    next: {
      input: string;
      prompt: string;
      model: string;
      settings: string;
    },
  ): RunKind {
    const artifact = currentArtifact(projectId, stageId);
    if (!artifact) return 'initial';
    const run = stageRun(artifact.run_id);
    if (!run) return 'initial';
    return storedRunFingerprint(run, stageId).combined
      === workflowFingerprint(next).combined
      ? 'variation'
      : 'regeneration';
  }

  function workflowSnapshots(projectId: string): WorkflowSnapshotSummary[] {
    const rows = database.prepare(`
      SELECT id, created_at, replaced_from_stage,
             design_brief_artifact_id, concept_screen_artifact_id, prd_artifact_id
      FROM workflow_snapshots
      WHERE project_id = ?
      ORDER BY created_at DESC, rowid DESC
    `).all(projectId) as unknown as WorkflowSnapshotRow[];
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      replacedFromStage: row.replaced_from_stage,
      artifactIds: {
        designBrief: row.design_brief_artifact_id,
        conceptScreens: row.concept_screen_artifact_id,
        prd: row.prd_artifact_id,
      },
    }));
  }

  function emitCandidateProgress(
    candidate: CandidateRow,
    phase: FullGenerationProgressEvent['phase'],
    currentStage: FullGenerationProgressEvent['currentStage'],
    currentOrdinal: ConceptScreenOrdinal | null,
    completedOperationCount: number,
  ): void {
    emitFullProgress({
      projectId: candidate.project_id,
      candidateId: candidate.id,
      phase,
      currentStage,
      currentOrdinal,
      completedOperationCount,
      totalOperationCount: 5,
      elapsedMs: Math.max(0, now().getTime() - new Date(candidate.started_at).getTime()),
    });
  }

  function candidateWarnings(candidate: CandidateRow): CandidateWarning[] {
    const artifacts = database.prepare(`
      SELECT stage_id, validation_json
      FROM artifacts
      WHERE id IN (?, ?, ?)
      ORDER BY CASE stage_id
        WHEN 'design_brief' THEN 1
        WHEN 'concept_screens' THEN 2
        WHEN 'prd' THEN 3
      END
    `).all(
      candidate.design_brief_artifact_id,
      candidate.concept_screen_artifact_id,
      candidate.prd_artifact_id,
    ) as unknown as Array<{ stage_id: CandidateWarning['stageId']; validation_json: string }>;
    return artifacts.flatMap((artifact) => {
      const validation = JSON.parse(artifact.validation_json) as {
        warnings?: Array<{ code: string; message: string }>;
      };
      return (validation.warnings ?? []).map((warning) => ({
        stageId: artifact.stage_id,
        code: warning.code,
        message: warning.message,
      }));
    });
  }

  function promoteCandidate(candidate: CandidateRow): ProjectWorkflow {
    if (
      !candidate.design_brief_artifact_id
      || !candidate.concept_screen_artifact_id
      || !candidate.prd_artifact_id
    ) {
      throw new WorkflowValidationError('The Candidate Workflow is not complete.');
    }
    const project = requireProject(candidate.project_id);
    const revision = candidate.insight_revision_id
      ? database.prepare(`
          SELECT id, project_id, insight_source, created_at, updated_at
          FROM insight_revisions
          WHERE id = ? AND project_id = ?
        `).get(candidate.insight_revision_id, candidate.project_id) as unknown as
          InsightRevisionRow | undefined
      : undefined;
    if (candidate.insight_revision_id && revision?.insight_source !== candidate.insight_source) {
      throw new WorkflowValidationError(
        'The Insight Revision changed while its Candidate Workflow was running.',
      );
    }
    if (!candidate.insight_revision_id && project.insight_source !== candidate.insight_source) {
      throw new WorkflowValidationError(
        'The Insight Source changed while Full Generation was running.',
      );
    }
    const currentDesignBrief = currentArtifact(candidate.project_id, 'design_brief');
    const currentConceptScreens = currentArtifact(candidate.project_id, 'concept_screens');
    const currentPrd = currentArtifact(candidate.project_id, 'prd');
    emitCandidateProgress(candidate, 'promoting', 'promotion', null, 5);
    database.exec('BEGIN IMMEDIATE;');
    try {
      if (currentDesignBrief && currentConceptScreens && currentPrd) {
        database.prepare(`
          INSERT INTO workflow_snapshots (
            id, project_id, created_at, replaced_from_stage,
            design_brief_artifact_id, concept_screen_artifact_id, prd_artifact_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          candidate.project_id,
          now().toISOString(),
          candidate.start_stage,
          currentDesignBrief.id,
          currentConceptScreens.id,
          currentPrd.id,
        );
      }
      const setCurrent = database.prepare(`
        INSERT INTO current_artifacts (project_id, stage_id, artifact_id)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id, stage_id) DO UPDATE SET artifact_id = excluded.artifact_id
      `);
      setCurrent.run(candidate.project_id, 'design_brief', candidate.design_brief_artifact_id);
      setCurrent.run(candidate.project_id, 'concept_screens', candidate.concept_screen_artifact_id);
      setCurrent.run(candidate.project_id, 'prd', candidate.prd_artifact_id);
      if (revision) {
        database.prepare(`
          UPDATE projects
          SET insight_source = ?, updated_at = ?
          WHERE id = ?
        `).run(revision.insight_source, now().toISOString(), candidate.project_id);
      }
      database.prepare('DELETE FROM pending_cascades WHERE project_id = ?')
        .run(candidate.project_id);
      database.prepare('DELETE FROM workflow_candidates WHERE id = ?').run(candidate.id);
      if (revision) {
        database.prepare('DELETE FROM insight_revisions WHERE id = ?').run(revision.id);
      }
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
        .run(now().toISOString(), candidate.project_id);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
    return readProjectWorkflow(candidate.project_id);
  }

  function finishCandidate(candidateId: string): ProjectWorkflow {
    const candidate = requireCandidate(
      (database.prepare('SELECT project_id FROM workflow_candidates WHERE id = ?')
        .get(candidateId) as unknown as { project_id: string }).project_id,
      candidateId,
    );
    const warnings = candidateWarnings(candidate);
    if (warnings.length > 0) {
      updateCandidate(candidate.id, {
        status: 'awaiting_warning_review',
        currentStage: 'promotion',
        completedOperationCount: 5,
        warnings,
        error: null,
      });
      const updated = requireCandidate(candidate.project_id, candidate.id);
      emitCandidateProgress(updated, 'awaiting_warning_review', 'promotion', null, 5);
      return readProjectWorkflow(candidate.project_id);
    }
    updateCandidate(candidate.id, {
      status: 'awaiting_promotion',
      currentStage: 'promotion',
      completedOperationCount: 5,
      warnings: [],
      error: null,
    });
    return readProjectWorkflow(candidate.project_id);
  }

  function readProjectWorkflow(projectId: string): ProjectWorkflow {
    const project = requireProject(projectId);
    const configuration = designBriefConfiguration();
    const imageConfiguration = conceptScreenConfiguration();
    const textConfiguration = prdConfiguration();
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
    const prdArtifact = database.prepare(`
      SELECT artifact.id, artifact.project_id, artifact.run_id,
             artifact.markdown, artifact.created_at, artifact.validation_json
      FROM current_artifacts AS current
      JOIN artifacts AS artifact ON artifact.id = current.artifact_id
      WHERE current.project_id = ? AND current.stage_id = 'prd'
    `).get(projectId) as unknown as ArtifactRow | undefined;
    const lastPrdRun = database.prepare(`
      SELECT *
      FROM stage_runs
      WHERE project_id = ? AND stage_id = 'prd'
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
    `).get(projectId) as unknown as RunRow | undefined;
    const hasInsight = project.insight_source.trim().length > 0;
    const hasPrd = Boolean(prdArtifact);
    const hasWorkflow = hasCurrentWorkflow(projectId);
    const candidate = candidateRow(projectId);
    return {
      projectId,
      insightRevision: insightRevisionFromRow(insightRevisionRow(projectId)),
      rerunPlan: readWorkflowRerunPlan(database, projectId),
      snapshots: workflowSnapshots(projectId),
      canGenerateFullWorkflow: hasInsight && !candidate && !hasWorkflow,
      fullGenerationBlocker: !hasInsight
        ? 'Add an Insight Source before starting Full Generation.'
        : candidate
          ? candidate.status === 'awaiting_warning_review'
            ? 'Review the Candidate Workflow warnings before promotion.'
            : candidate.status === 'awaiting_promotion'
              ? 'The Candidate Workflow is ready for promotion.'
              : candidate.status === 'kept_after_warning_review'
                ? 'The warning-bearing Candidate Workflow is being kept for later.'
              : 'Resume or discard the existing Candidate Workflow first.'
          : hasWorkflow
            ? 'Use safe regeneration to replace a current workflow.'
          : null,
      candidate: candidateFromRow(candidate),
      canGenerateDesignBrief: hasInsight && !hasPrd,
      generationBlocker: !hasInsight
        ? 'Add an Insight Source before generating a Design Brief.'
        : hasPrd
          ? 'Regenerate the complete downstream workflow to replace a current PRD consistently.'
          : null,
      designBrief: artifactFromRow(artifact),
      lastDesignBriefRun: runFromRow(lastRun),
      designBriefConfiguration: {
        model: configuration.model,
        promptUpdatedAt: configuration.updated_at,
      },
      canGenerateConceptScreens: Boolean(artifact) && !hasPrd,
      conceptScreenGenerationBlocker: !artifact
        ? 'Generate a Design Brief before generating Concept Screens.'
        : hasPrd
          ? 'Regenerate the PRD with any new Concept Screen Set to keep the workflow consistent.'
          : null,
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
      canGeneratePrd: Boolean(artifact && conceptArtifact),
      prdGenerationBlocker: artifact && conceptArtifact
        ? null
        : 'Generate a Design Brief and Concept Screen Set before generating a PRD.',
      prd: prdArtifactFromRow(prdArtifact),
      lastPrdRun: prdRunFromRow(lastPrdRun),
      prdConfiguration: {
        model: textConfiguration.model,
        promptUpdatedAt: textConfiguration.updated_at,
      },
    };
  }

  async function continueFullCandidate(candidate: CandidateRow): Promise<ProjectWorkflow> {
    activeFullRuns.set(candidate.project_id, {
      candidateId: candidate.id,
      cancelRequested: false,
    });
    updateCandidate(candidate.id, { status: 'running', error: null });
    try {
      let result: ProjectWorkflow;
      if (!candidate.design_brief_artifact_id) {
        result = await service.generateDesignBrief(candidate.project_id, candidate.id);
      } else if (!candidate.concept_screen_artifact_id) {
        result = await service.generateConceptScreens(candidate.project_id, candidate.id);
      } else if (!candidate.prd_artifact_id) {
        result = await service.generatePrd(candidate.project_id, candidate.id);
      } else {
        result = finishCandidate(candidate.id);
      }
      const current = candidateRow(candidate.project_id);
      if (current?.id === candidate.id && current.status === 'running') {
        updateCandidate(candidate.id, { status: 'paused', error: null });
        return readProjectWorkflow(candidate.project_id);
      }
      return result;
    } catch (error) {
      const cancellation = error instanceof WorkflowCancellationError
        || (error instanceof WorkflowGenerationError && error.code === 'cancelled');
      const code = cancellation
        ? 'cancelled'
        : error instanceof WorkflowGenerationError
          ? error.code
          : error instanceof WorkflowValidationError
            ? 'invalid_artifact'
            : 'generation_failed';
      const message = error instanceof Error
        ? error.message
        : 'Full Generation failed.';
      const current = candidateRow(candidate.project_id);
      if (current?.id === candidate.id) {
        updateCandidate(candidate.id, {
          status: cancellation ? 'cancelled' : 'failed',
          error: { code, message },
        });
        emitCandidateProgress(
          current,
          cancellation ? 'cancelled' : 'failed',
          current.current_stage,
          null,
          current.completed_operation_count,
        );
      }
      if (error instanceof WorkflowGenerationError) throw error;
      throw new WorkflowGenerationError(code, message);
    } finally {
      activeFullRuns.delete(candidate.project_id);
    }
  }

  const service: WorkflowService = {
    getProjectWorkflow(projectId) {
      return readProjectWorkflow(projectId);
    },

    async generateDesignBrief(projectId, candidateId) {
      assertGenerationAvailable(projectId, candidateId);
      const candidate = candidateId ? requireCandidate(projectId, candidateId) : null;
      const project = requireProject(projectId);
      const insightSource = candidate?.insight_source ?? project.insight_source;
      if (activeDesignBriefRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'Design Brief generation is already running for this Project.',
        );
      }
      if (activeConceptRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'Concept Screen generation is already running for this Project.',
        );
      }
      if (activePrdRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'PRD generation is already running for this Project.',
        );
      }
      if (!insightSource.trim()) {
        throw new WorkflowValidationError(
          'Add an Insight Source before generating a Design Brief.',
        );
      }
      if (!candidate && hasCurrentPrd(projectId)) {
        throw new WorkflowValidationError(
          'Regenerate the complete downstream workflow to replace a current PRD consistently.',
        );
      }
      const configuration = candidate
        ? candidateConfigurations(candidate).designBrief
        : designBriefConfiguration();
      const runKind = classifyStageRun(projectId, 'design_brief', {
        input: insightSource,
        prompt: configuration.prompt,
        model: configuration.model,
        settings: 'null',
      });
      const requiresDownstreamCascade = Boolean(candidate) || Boolean(database.prepare(`
        SELECT 1
        FROM current_artifacts
        WHERE project_id = ? AND stage_id = 'concept_screens'
      `).get(projectId));
      const runId = randomUUID();
      const startedAt = now();
      const assembledRequest = [
        'Stage Prompt:',
        configuration.prompt,
        '',
        'Stage Input — Insight Source:',
        insightSource,
      ].join('\n');
      database.prepare(`
        INSERT INTO stage_runs (
          id, project_id, stage_id, run_kind, status, started_at,
          prompt_snapshot, model_snapshot, stage_configuration_updated_at,
          input_snapshot, assembled_request
        ) VALUES (?, ?, 'design_brief', ?, 'running', ?, ?, ?, ?, ?, ?)
      `).run(
        runId,
        projectId,
        runKind,
        startedAt.toISOString(),
        configuration.prompt,
        configuration.model,
        configuration.updated_at,
        insightSource,
        assembledRequest,
      );
      if (candidate) {
        database.prepare(`
          UPDATE workflow_candidates
          SET design_brief_run_id = ?, current_stage = 'design_brief', updated_at = ?
          WHERE id = ?
        `).run(runId, now().toISOString(), candidate.id);
        emitCandidateProgress(candidate, 'generating', 'design_brief', null, 0);
      }

      let generated: DesignBriefGenerationResult;
      let validation: ArtifactValidation;
      activeDesignBriefRuns.add(projectId);
      try {
        generated = await options.textGeneration.generateDesignBrief({
          model: configuration.model,
          stagePrompt: configuration.prompt,
          insightSource,
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
        activeDesignBriefRuns.delete(projectId);
        throw new WorkflowGenerationError(code, message);
      }
      activeDesignBriefRuns.delete(projectId);
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
        if (!requiresDownstreamCascade) {
          database.prepare(`
            INSERT INTO current_artifacts (project_id, stage_id, artifact_id)
            VALUES (?, 'design_brief', ?)
            ON CONFLICT(project_id, stage_id) DO UPDATE SET
              artifact_id = excluded.artifact_id
          `).run(projectId, artifactId);
          database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
            .run(completedAt.toISOString(), projectId);
        }
        if (candidate) {
          database.prepare(`
            UPDATE workflow_candidates
            SET design_brief_artifact_id = ?, completed_operation_count = 1,
                current_stage = 'concept_screens', updated_at = ?
            WHERE id = ?
          `).run(artifactId, completedAt.toISOString(), candidate.id);
        }
        database.exec('COMMIT;');
      } catch (error) {
        database.exec('ROLLBACK;');
        throw error;
      }

      if (!requiresDownstreamCascade) return readProjectWorkflow(projectId);

      database.prepare(`
        INSERT INTO pending_cascades (
          project_id, design_brief_artifact_id, created_at
        ) VALUES (?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          design_brief_artifact_id = excluded.design_brief_artifact_id,
          created_at = excluded.created_at
      `).run(projectId, artifactId, completedAt.toISOString());
      if (candidate) {
        if (activeFullRuns.get(projectId)?.cancelRequested) {
          throw new WorkflowCancellationError();
        }
        return readProjectWorkflow(projectId);
      }
      return service.generateConceptScreens(projectId);
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

    exportDeliverables(projectId) {
      const project = requireProject(projectId);
      const designBrief = currentArtifact(projectId, 'design_brief');
      const conceptScreenSet = currentArtifact(projectId, 'concept_screens');
      const prd = currentArtifact(projectId, 'prd');
      if (!designBrief || !conceptScreenSet || !prd) {
        throw new WorkflowValidationError(
          'Generate the complete workflow before exporting deliverables.',
        );
      }
      const designBriefRunRow = stageRun(designBrief.run_id);
      const conceptRunRow = stageRun(conceptScreenSet.run_id);
      const prdRunRow = stageRun(prd.run_id);
      const operations = conceptOperations(conceptScreenSet.run_id);
      const completeOperations = operations.filter((operation) =>
        operation.status === 'succeeded'
        && operation.asset_id
        && operation.relative_path);
      if (
        designBriefRunRow?.status !== 'succeeded'
        || conceptRunRow?.status !== 'succeeded'
        || prdRunRow?.status !== 'succeeded'
        || completeOperations.length !== 3
      ) {
        throw new WorkflowValidationError(
          'Generate the complete workflow before exporting deliverables.',
        );
      }
      const designBriefRun = runFromRow(designBriefRunRow)!;
      const conceptRun = conceptRunFromRows(conceptRunRow, operations)!;
      const prdRun = prdRunFromRow(prdRunRow)!;
      const screenFiles = completeOperations.map((operation) => ({
        name: `concept-screen-${operation.ordinal}.png`,
        bytes: readFileSync(join(dataDirectory, operation.relative_path!)),
      }));
      const manifest = {
        schemaVersion: 1,
        project: {
          id: project.id,
          name: project.name,
        },
        exportedAt: now().toISOString(),
        stages: [
          {
            stageId: 'design_brief',
            stage: 'Design Brief',
            file: 'design-brief.md',
            artifactId: designBrief.id,
            runId: designBriefRun.id,
            generatedAt: designBrief.created_at,
            model: designBriefRun.model,
            prompt: designBriefRun.stagePrompt,
            stageConfigurationUpdatedAt: designBriefRun.stageConfigurationUpdatedAt,
            startedAt: designBriefRun.startedAt,
            completedAt: designBriefRun.completedAt,
            durationMs: designBriefRun.durationMs,
            requestId: designBriefRun.requestId,
            responseId: designBriefRun.responseId,
            usage: designBriefRun.usage,
            validation: designBriefRun.validation,
          },
          {
            stageId: 'concept_screens',
            stage: 'Concept Screen Set',
            files: screenFiles.map(({ name }) => name),
            artifactId: conceptScreenSet.id,
            runId: conceptRun.id,
            generatedAt: conceptScreenSet.created_at,
            model: conceptRun.model,
            prompt: conceptRun.stagePrompt,
            imageQuality: conceptRun.imageQuality,
            stageConfigurationUpdatedAt: conceptRun.stageConfigurationUpdatedAt,
            startedAt: conceptRun.startedAt,
            completedAt: conceptRun.completedAt,
            durationMs: conceptRun.durationMs,
            usage: conceptRun.usage,
            validation: conceptRun.validation,
            input: {
              stage: conceptRun.stageInput.name,
              artifactId: conceptRun.stageInput.artifactId,
              runId: conceptRun.stageInput.runId,
            },
            operations: completeOperations.map((operation) => ({
              ordinal: operation.ordinal,
              file: `concept-screen-${operation.ordinal}.png`,
              assetId: operation.asset_id,
              completedAt: operation.completed_at,
              durationMs: operation.duration_ms,
              width: operation.width,
              height: operation.height,
              requestId: operation.request_id,
              responseId: operation.response_id,
              usage: readJson<TokenUsage>(operation.usage_json),
            })),
          },
          {
            stageId: 'prd',
            stage: 'PRD',
            file: 'prd.md',
            artifactId: prd.id,
            runId: prdRun.id,
            generatedAt: prd.created_at,
            model: prdRun.model,
            prompt: prdRun.stagePrompt,
            stageConfigurationUpdatedAt: prdRun.stageConfigurationUpdatedAt,
            startedAt: prdRun.startedAt,
            completedAt: prdRun.completedAt,
            durationMs: prdRun.durationMs,
            requestId: prdRun.requestId,
            responseId: prdRun.responseId,
            usage: prdRun.usage,
            validation: prdRun.validation,
            input: {
              designBrief: {
                artifactId: prdRun.stageInput.designBrief.artifactId,
                runId: prdRun.stageInput.designBrief.runId,
              },
              conceptScreenSet: {
                artifactId: prdRun.stageInput.conceptScreenSet.artifactId,
                runId: prdRun.stageInput.conceptScreenSet.runId,
                assets: prdRun.stageInput.conceptScreenSet.screens.map((screen) => ({
                  ordinal: screen.ordinal,
                  assetId: screen.assetId,
                })),
              },
            },
          },
        ],
      };
      const archive = zipSync({
        'design-brief.md': strToU8(designBrief.markdown),
        ...Object.fromEntries(screenFiles.map(({ name, bytes }) => [name, bytes])),
        'prd.md': strToU8(prd.markdown),
        'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
      }, { level: 6 });
      return {
        fileName: `${fileNameSlug(project.name)}-deliverables.zip`,
        bytes: Buffer.from(archive),
      };
    },

    async generateConceptScreens(projectId, candidateId) {
      assertGenerationAvailable(projectId, candidateId);
      const candidate = candidateId ? requireCandidate(projectId, candidateId) : null;
      requireProject(projectId);
      if (activeDesignBriefRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'Design Brief generation is already running for this Project.',
        );
      }
      if (activePrdRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'PRD generation is already running for this Project.',
        );
      }
      if (!candidate && hasCurrentPrd(projectId)) {
        throw new WorkflowValidationError(
          'Regenerate the PRD with any new Concept Screen Set to keep the workflow consistent.',
        );
      }
      if (activeConceptRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'Concept Screen generation is already running for this Project.',
        );
      }
      const designBrief = pendingDesignBriefCandidate(projectId)
        ?? database.prepare(`
        SELECT artifact.id, artifact.run_id, artifact.markdown
        FROM current_artifacts AS current
        JOIN artifacts AS artifact ON artifact.id = current.artifact_id
        WHERE current.project_id = ? AND current.stage_id = 'design_brief'
      `).get(projectId) as unknown as {
        id: string;
        run_id: string;
        markdown: string;
      } | undefined;
      if (!designBrief) {
        throw new WorkflowValidationError(
          'Generate a Design Brief before generating Concept Screens.',
        );
      }
      const configuration = candidate
        ? candidateConfigurations(candidate).conceptScreens
        : conceptScreenConfiguration();
      const settingsJson = JSON.stringify({ imageQuality: configuration.image_quality });
      const runKind = classifyStageRun(projectId, 'concept_screens', {
        input: designBrief.markdown,
        prompt: configuration.prompt,
        model: configuration.model,
        settings: settingsJson,
      });
      const assembledRequest = [
        'Stage Prompt:',
        configuration.prompt,
        '',
        'Stage Input — Design Brief:',
        designBrief.markdown,
      ].join('\n');
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
        const priorHistory = readJson<ConceptScreenAttemptHistory[]>(
          resumableRun.attempt_history_json,
        ) ?? [];
        const archivedAttempt: ConceptScreenAttemptHistory = {
          status: resumableRun.error_code === 'cancelled' ? 'cancelled' : 'failed',
          completedAt: resumableRun.completed_at,
          durationMs: resumableRun.duration_ms,
          usage: readJson<TokenUsage>(resumableRun.usage_json),
          error: resumableRun.error_code && resumableRun.error_message
            ? { code: resumableRun.error_code, message: resumableRun.error_message }
            : null,
          operations: conceptOperations(runId).map(conceptOperationFromRow),
        };
        database.prepare(`
          UPDATE stage_runs
          SET run_kind = ?, status = 'running', completed_at = NULL, duration_ms = ?,
              validation_json = NULL, error_code = NULL, error_message = NULL,
              attempt_history_json = ?
          WHERE id = ?
        `).run(
          runKind,
          priorDurationMs,
          JSON.stringify([...priorHistory, archivedAttempt]),
          runId,
        );
      } else {
        database.prepare(`
          INSERT INTO stage_runs (
            id, project_id, stage_id, run_kind, status, started_at,
            prompt_snapshot, model_snapshot, stage_configuration_updated_at,
            input_snapshot, input_artifact_id, input_run_id,
            assembled_request, settings_json
          ) VALUES (?, ?, 'concept_screens', ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          runId,
          projectId,
          runKind,
          runStartedAt.toISOString(),
          configuration.prompt,
          configuration.model,
          configuration.updated_at,
          designBrief.markdown,
          designBrief.id,
          designBrief.run_id,
          assembledRequest,
          settingsJson,
        );
      }
      if (candidate) {
        database.prepare(`
          UPDATE workflow_candidates
          SET concept_screen_run_id = ?, current_stage = 'concept_screens', updated_at = ?
          WHERE id = ?
        `).run(runId, now().toISOString(), candidate.id);
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
      let totalUsage: TokenUsage = resumableRun
        ? readJson<TokenUsage>(resumableRun.usage_json) ?? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        }
        : {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
      activeConceptRuns.set(projectId, { runId, cancelRequested: false });
      let activeOperationIdentifiers: {
        requestId: string | null;
        responseId: string | null;
        usage: TokenUsage;
      } | null = null;

      try {
        for (const ordinal of [1, 2, 3] as const) {
          if (completed.some((screen) => screen.ordinal === ordinal)) continue;
          if (activeConceptRuns.get(projectId)?.cancelRequested) {
            throw new WorkflowCancellationError();
          }
          const operationStartedAt = now();
          emitConceptProgress({
            projectId,
            runId,
            phase: 'generating',
            currentOrdinal: ordinal,
            completedOperationCount: completed.length,
            elapsedMs: priorDurationMs + Math.max(
              0,
              operationStartedAt.getTime() - attemptStartedAt.getTime(),
            ),
          });
          if (candidate) {
            emitCandidateProgress(
              candidate,
              'generating',
              'concept_screens',
              ordinal,
              1 + completed.length,
            );
          }
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
            usage: generated.usage,
          };
          totalUsage = addUsage(totalUsage, generated.usage);
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
          completed.push({ ordinal, assetId, png: generated.png, ...dimensions });
          if (candidate) {
            database.prepare(`
              UPDATE workflow_candidates
              SET completed_operation_count = ?, updated_at = ?
              WHERE id = ?
            `).run(1 + completed.length, operationCompletedAt.toISOString(), candidate.id);
          }
          activeOperationIdentifiers = null;
        }

        emitConceptProgress({
          projectId,
          runId,
          phase: 'validating',
          currentOrdinal: null,
          completedOperationCount: completed.length,
          elapsedMs: priorDurationMs + Math.max(0, now().getTime() - attemptStartedAt.getTime()),
        });
        const operations = conceptOperations(runId);
        const validation = validateConceptScreenSet(operations);
        const completedAt = now();
        const artifactId = randomUUID();
        emitConceptProgress({
          projectId,
          runId,
          phase: 'promoting',
          currentOrdinal: null,
          completedOperationCount: completed.length,
          elapsedMs: priorDurationMs + Math.max(
            0,
            completedAt.getTime() - attemptStartedAt.getTime(),
          ),
        });
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
          if (candidate) {
            database.prepare(`
              UPDATE workflow_candidates
              SET concept_screen_artifact_id = ?, completed_operation_count = 4,
                  current_stage = 'prd', updated_at = ?
              WHERE id = ?
            `).run(artifactId, completedAt.toISOString(), candidate.id);
          } else {
            database.prepare(`
              INSERT INTO current_artifacts (project_id, stage_id, artifact_id)
              VALUES (?, 'concept_screens', ?)
              ON CONFLICT(project_id, stage_id) DO UPDATE SET
                artifact_id = excluded.artifact_id
            `).run(projectId, artifactId);
            const designBriefCandidate = pendingDesignBriefCandidate(projectId);
            if (designBriefCandidate) {
              database.prepare(`
                INSERT INTO current_artifacts (project_id, stage_id, artifact_id)
                VALUES (?, 'design_brief', ?)
                ON CONFLICT(project_id, stage_id) DO UPDATE SET
                  artifact_id = excluded.artifact_id
              `).run(projectId, designBriefCandidate.id);
              database.prepare('DELETE FROM pending_cascades WHERE project_id = ?')
                .run(projectId);
            }
            database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
              .run(completedAt.toISOString(), projectId);
          }
          database.exec('COMMIT;');
          emitConceptProgress({
            projectId,
            runId,
            phase: 'completed',
            currentOrdinal: null,
            completedOperationCount: completed.length,
            elapsedMs: priorDurationMs + Math.max(
              0,
              completedAt.getTime() - attemptStartedAt.getTime(),
            ),
          });
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
              usage_json = COALESCE(?, usage_json),
              error_code = ?, error_message = ?
          WHERE run_id = ? AND status = 'running'
        `).run(
          completedAt.toISOString(),
          completedAt.toISOString(),
          boundaryError?.requestId ?? activeOperationIdentifiers?.requestId ?? null,
          boundaryError?.responseId ?? activeOperationIdentifiers?.responseId ?? null,
          activeOperationIdentifiers
            ? JSON.stringify(activeOperationIdentifiers.usage)
            : null,
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
        emitConceptProgress({
          projectId,
          runId,
          phase: 'failed',
          currentOrdinal: null,
          completedOperationCount: completed.length,
          elapsedMs: priorDurationMs + Math.max(
            0,
            completedAt.getTime() - attemptStartedAt.getTime(),
          ),
        });
        activeConceptRuns.delete(projectId);
        throw new WorkflowGenerationError(code, message);
      }

      activeConceptRuns.delete(projectId);
      if (candidate && activeFullRuns.get(projectId)?.cancelRequested) {
        throw new WorkflowCancellationError();
      }
      return readProjectWorkflow(projectId);
    },

    async generatePrd(projectId, candidateId) {
      assertGenerationAvailable(projectId, candidateId);
      const candidate = candidateId ? requireCandidate(projectId, candidateId) : null;
      requireProject(projectId);
      if (activeDesignBriefRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'Design Brief generation is already running for this Project.',
        );
      }
      if (activePrdRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'PRD generation is already running for this Project.',
        );
      }
      if (activeConceptRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'Concept Screen generation is already running for this Project.',
        );
      }
      if (!candidate && hasCurrentPrd(projectId)) {
        throw new WorkflowValidationError(
          'Use a Candidate Workflow to replace the current PRD safely.',
        );
      }
      if (!candidate && pendingDesignBriefCandidate(projectId)) {
        throw new WorkflowValidationError(
          'Finish or resume the pending downstream cascade before generating a PRD.',
        );
      }
      activePrdRuns.add(projectId);
      try {
      const designBrief = (candidate
        ? database.prepare(`
          SELECT id, project_id, run_id, markdown, created_at, validation_json
          FROM artifacts WHERE id = ? AND project_id = ? AND stage_id = 'design_brief'
        `).get(candidate.design_brief_artifact_id, projectId)
        : database.prepare(`
        SELECT artifact.id, artifact.project_id, artifact.run_id,
               artifact.markdown, artifact.created_at, artifact.validation_json
        FROM current_artifacts AS current
        JOIN artifacts AS artifact ON artifact.id = current.artifact_id
        WHERE current.project_id = ? AND current.stage_id = 'design_brief'
      `).get(projectId)) as unknown as ArtifactRow | undefined;
      const conceptScreenSet = (candidate
        ? database.prepare(`
          SELECT id, project_id, run_id, created_at, validation_json
          FROM artifacts WHERE id = ? AND project_id = ? AND stage_id = 'concept_screens'
        `).get(candidate.concept_screen_artifact_id, projectId)
        : database.prepare(`
        SELECT artifact.id, artifact.project_id, artifact.run_id,
               artifact.created_at, artifact.validation_json
        FROM current_artifacts AS current
        JOIN artifacts AS artifact ON artifact.id = current.artifact_id
        WHERE current.project_id = ? AND current.stage_id = 'concept_screens'
      `).get(projectId)) as unknown as ConceptArtifactRow | undefined;
      if (!designBrief || !conceptScreenSet) {
        throw new WorkflowValidationError(
          'Generate a Design Brief and Concept Screen Set before generating a PRD.',
        );
      }
      const operations = conceptOperations(conceptScreenSet.run_id)
        .filter((operation) => operation.status === 'succeeded');
      if (operations.length !== 3 || operations.some((operation) =>
        !operation.asset_id || !operation.relative_path
        || !operation.width || !operation.height)) {
        throw new WorkflowValidationError(
          'The current Concept Screen Set does not contain three usable PNGs.',
        );
      }
      const configuration = candidate
        ? candidateConfigurations(candidate).prd
        : prdConfiguration();
      const stageInput = buildPrdStageInput(
        designBrief,
        conceptScreenSet,
        operations,
      );
      const runKind = classifyStageRun(projectId, 'prd', {
        input: JSON.stringify(stageInput),
        prompt: configuration.prompt,
        model: configuration.model,
        settings: 'null',
      });
      const assembledRequest = [
        'Stage Prompt:',
        configuration.prompt,
        '',
        'Stage Input — Design Brief:',
        designBrief.markdown,
        '',
        'Stage Input — Concept Screen Set:',
        ...stageInput.conceptScreenSet.screens.map((screen) =>
          `Concept Screen ${screen.ordinal}: PNG asset ${screen.assetId} (${screen.width}×${screen.height})`),
      ].join('\n');
      const runId = randomUUID();
      const startedAt = now();
      database.prepare(`
        INSERT INTO stage_runs (
          id, project_id, stage_id, run_kind, status, started_at,
          prompt_snapshot, model_snapshot, stage_configuration_updated_at,
          input_snapshot, input_artifact_id, input_run_id,
          input_lineage_json, assembled_request
        ) VALUES (?, ?, 'prd', ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runId,
        projectId,
        runKind,
        startedAt.toISOString(),
        configuration.prompt,
        configuration.model,
        configuration.updated_at,
        designBrief.markdown,
        designBrief.id,
        designBrief.run_id,
        JSON.stringify(stageInput),
        assembledRequest,
      );
      if (candidate) {
        database.prepare(`
          UPDATE workflow_candidates
          SET prd_run_id = ?, current_stage = 'prd', updated_at = ?
          WHERE id = ?
        `).run(runId, now().toISOString(), candidate.id);
        emitCandidateProgress(candidate, 'generating', 'prd', null, 4);
      }

      let generated: PrdGenerationResult;
      let validation: ArtifactValidation;
      try {
        generated = await options.textGeneration.generatePrd({
          model: configuration.model,
          stagePrompt: configuration.prompt,
          designBrief: designBrief.markdown,
          conceptScreens: operations.map((operation) => ({
            ordinal: operation.ordinal,
            png: readFileSync(join(dataDirectory, operation.relative_path!)),
          })),
        });
        validation = validateMarkdownArtifact(generated.markdown, 'PRD');
      } catch (error) {
        const completedAt = now();
        const boundaryError = error instanceof GenerationBoundaryError ? error : null;
        const validationError = error instanceof WorkflowValidationError ? error : null;
        const code = boundaryError?.code
          ?? (validationError ? 'invalid_artifact' : 'generation_failed');
        const message = boundaryError?.message
          ?? validationError?.message
          ?? 'PRD generation failed.';
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
      const artifactId = randomUUID();
      database.exec('BEGIN IMMEDIATE;');
      try {
        const currentDesignBrief = database.prepare(`
          SELECT artifact_id
          FROM current_artifacts
          WHERE project_id = ? AND stage_id = 'design_brief'
        `).get(projectId) as unknown as { artifact_id: string } | undefined;
        const currentConceptScreenSet = database.prepare(`
          SELECT artifact_id
          FROM current_artifacts
          WHERE project_id = ? AND stage_id = 'concept_screens'
        `).get(projectId) as unknown as { artifact_id: string } | undefined;
        if (!candidate && (
          currentDesignBrief?.artifact_id !== designBrief.id
          || currentConceptScreenSet?.artifact_id !== conceptScreenSet.id
        )) {
          throw new WorkflowValidationError(
            'PRD inputs changed before promotion; run the stage again with the current workflow.',
          );
        }
        database.prepare(`
          UPDATE stage_runs
          SET status = 'succeeded', completed_at = ?, duration_ms = ?,
              response_id = ?, request_id = ?, usage_json = ?, validation_json = ?
          WHERE id = ?
        `).run(
          completedAt.toISOString(),
          Math.max(0, completedAt.getTime() - startedAt.getTime()),
          generated.responseId,
          generated.requestId,
          JSON.stringify(generated.usage),
          JSON.stringify(validation),
          runId,
        );
        database.prepare(`
          INSERT INTO artifacts (
            id, project_id, stage_id, run_id, markdown, created_at, validation_json
          ) VALUES (?, ?, 'prd', ?, ?, ?, ?)
        `).run(
          artifactId,
          projectId,
          runId,
          generated.markdown.trim(),
          completedAt.toISOString(),
          JSON.stringify(validation),
        );
        if (candidate) {
          database.prepare(`
            UPDATE workflow_candidates
            SET prd_artifact_id = ?, completed_operation_count = 5,
                current_stage = 'promotion', updated_at = ?
            WHERE id = ?
          `).run(artifactId, completedAt.toISOString(), candidate.id);
        } else {
          database.prepare(`
            INSERT INTO current_artifacts (project_id, stage_id, artifact_id)
            VALUES (?, 'prd', ?)
            ON CONFLICT(project_id, stage_id) DO UPDATE SET
              artifact_id = excluded.artifact_id
          `).run(projectId, artifactId);
          database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
            .run(completedAt.toISOString(), projectId);
        }
        database.exec('COMMIT;');
      } catch (error) {
        database.exec('ROLLBACK;');
        const failedAt = now();
        const code = error instanceof WorkflowValidationError
          ? 'invalid_artifact'
          : 'generation_failed';
        const message = error instanceof WorkflowValidationError
          ? error.message
          : 'PRD promotion failed.';
        database.prepare(`
          UPDATE stage_runs
          SET status = 'failed', completed_at = ?, duration_ms = ?,
              error_code = ?, error_message = ?
          WHERE id = ?
        `).run(
          failedAt.toISOString(),
          Math.max(0, failedAt.getTime() - startedAt.getTime()),
          code,
          message,
          runId,
        );
        throw new WorkflowGenerationError(code, message);
      }
      if (candidate) {
        if (activeFullRuns.get(projectId)?.cancelRequested) {
          throw new WorkflowCancellationError();
        }
        emitCandidateProgress(candidate, 'validating', 'promotion', null, 5);
        return finishCandidate(candidate.id);
      }
      return readProjectWorkflow(projectId);
      } finally {
        activePrdRuns.delete(projectId);
      }
    },

    async generateFullWorkflow(projectId) {
      const project = requireProject(projectId);
      if (!project.insight_source.trim()) {
        throw new WorkflowValidationError(
          'Add an Insight Source before starting Full Generation.',
        );
      }
      if (hasCurrentWorkflow(projectId)) {
        throw new WorkflowValidationError(
          'Use safe regeneration to replace a current workflow.',
        );
      }
      if (candidateRow(projectId)) {
        throw new WorkflowValidationError(
          'Resume or discard the existing Candidate Workflow first.',
        );
      }
      if (
        activeDesignBriefRuns.has(projectId)
        || activeConceptRuns.has(projectId)
        || activePrdRuns.has(projectId)
        || activeFullRuns.has(projectId)
      ) {
        throw new WorkflowValidationError(
          'Generation is already running for this Project.',
        );
      }
      if (pendingDesignBriefCandidate(projectId)) {
        throw new WorkflowValidationError(
          'Finish the pending guided cascade before starting Full Generation.',
        );
      }
      const candidateId = randomUUID();
      const startedAt = now().toISOString();
      const configurations: CandidateConfigurations = {
        designBrief: designBriefConfiguration(),
        conceptScreens: conceptScreenConfiguration(),
        prd: prdConfiguration(),
      };
      database.prepare(`
        INSERT INTO workflow_candidates (
          id, project_id, status, current_stage, completed_operation_count,
          start_stage, insight_source, configuration_json, started_at, updated_at
        ) VALUES (?, ?, 'running', 'design_brief', 0, 'design_brief', ?, ?, ?, ?)
      `).run(
        candidateId,
        projectId,
        project.insight_source,
        JSON.stringify(configurations),
        startedAt,
        startedAt,
      );
      return continueFullCandidate(requireCandidate(projectId, candidateId));
    },

    async regenerateWorkflow(projectId, startStage) {
      const project = requireProject(projectId);
      if (!generatedStageIds.includes(startStage)) {
        throw new WorkflowValidationError('Choose a valid stage to regenerate.');
      }
      if (candidateRow(projectId)) {
        throw new WorkflowValidationError(
          'Resume or discard the existing Candidate Workflow first.',
        );
      }
      if (
        activeDesignBriefRuns.has(projectId)
        || activeConceptRuns.has(projectId)
        || activePrdRuns.has(projectId)
        || activeFullRuns.has(projectId)
      ) {
        throw new WorkflowValidationError(
          'Generation is already running for this Project.',
        );
      }
      const currentDesignBrief = currentArtifact(projectId, 'design_brief');
      const currentConceptScreens = currentArtifact(projectId, 'concept_screens');
      const currentPrd = currentArtifact(projectId, 'prd');
      if (!currentDesignBrief || !currentConceptScreens || !currentPrd) {
        throw new WorkflowValidationError(
          'Generate the complete workflow before regenerating from a stage.',
        );
      }
      const update = readWorkflowRerunPlan(database, projectId);
      if (
        update
        && startStage !== update.earliestChangedStage
      ) {
        throw new WorkflowValidationError(
          `Regenerate from ${generatedStageNames[update.earliestChangedStage]} to begin at the earliest changed stage.`,
        );
      }
      const candidateId = randomUUID();
      const startedAt = now().toISOString();
      const runKind: RunKind = update ? 'regeneration' : 'variation';
      const configurations: CandidateConfigurations = {
        designBrief: designBriefConfiguration(),
        conceptScreens: conceptScreenConfiguration(),
        prd: prdConfiguration(),
      };
      const startsAtIndex = generatedStageIds.indexOf(startStage);
      const completedOperationCount = startStage === 'design_brief'
        ? 0
        : startStage === 'concept_screens'
          ? 1
          : 4;
      database.prepare(`
        INSERT INTO workflow_candidates (
          id, project_id, run_kind, status, current_stage, completed_operation_count,
          start_stage, insight_source, configuration_json,
          design_brief_run_id, design_brief_artifact_id,
          concept_screen_run_id, concept_screen_artifact_id,
          started_at, updated_at
        ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candidateId,
        projectId,
        runKind,
        startStage,
        completedOperationCount,
        startStage,
        project.insight_source,
        JSON.stringify(configurations),
        startsAtIndex > 0 ? currentDesignBrief.run_id : null,
        startsAtIndex > 0 ? currentDesignBrief.id : null,
        startsAtIndex > 1 ? currentConceptScreens.run_id : null,
        startsAtIndex > 1 ? currentConceptScreens.id : null,
        startedAt,
        startedAt,
      );
      return continueFullCandidate(requireCandidate(projectId, candidateId));
    },

    beginInsightRevision(projectId) {
      requireProject(projectId);
      const existing = insightRevisionRow(projectId);
      if (existing) return readProjectWorkflow(projectId);
      if (candidateRow(projectId)) {
        throw new WorkflowValidationError(
          'Resume or discard the existing Candidate Workflow first.',
        );
      }
      if (!hasCurrentWorkflow(projectId)) {
        throw new WorkflowValidationError(
          'Generate the complete workflow before revising the Insight Source.',
        );
      }
      const project = requireProject(projectId);
      const timestamp = now().toISOString();
      database.prepare(`
        INSERT INTO insight_revisions (
          id, project_id, insight_source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), projectId, project.insight_source, timestamp, timestamp);
      return readProjectWorkflow(projectId);
    },

    updateInsightRevision(projectId, insightSource) {
      requireProject(projectId);
      if (candidateRow(projectId)) {
        throw new WorkflowValidationError(
          'The Insight Revision cannot change after candidate generation starts.',
        );
      }
      const result = database.prepare(`
        UPDATE insight_revisions
        SET insight_source = ?, updated_at = ?
        WHERE project_id = ?
      `).run(insightSource, now().toISOString(), projectId);
      if (result.changes === 0) {
        throw new WorkflowValidationError('Begin an Insight Revision before editing it.');
      }
      return readProjectWorkflow(projectId);
    },

    async generateInsightRevision(projectId) {
      const project = requireProject(projectId);
      const revision = insightRevisionRow(projectId);
      if (!revision) {
        throw new WorkflowValidationError('Begin an Insight Revision before generating it.');
      }
      if (!revision.insight_source.trim()) {
        throw new WorkflowValidationError(
          'Add an Insight Source to the revision before generating it.',
        );
      }
      if (revision.insight_source === project.insight_source) {
        throw new WorkflowValidationError(
          'Change the Insight Source before generating its revision.',
        );
      }
      if (!hasCurrentWorkflow(projectId)) {
        throw new WorkflowValidationError(
          'Generate the complete workflow before revising the Insight Source.',
        );
      }
      if (candidateRow(projectId)) {
        throw new WorkflowValidationError(
          'Resume or discard the existing Candidate Workflow first.',
        );
      }
      if (
        activeDesignBriefRuns.has(projectId)
        || activeConceptRuns.has(projectId)
        || activePrdRuns.has(projectId)
        || activeFullRuns.has(projectId)
      ) {
        throw new WorkflowValidationError(
          'Generation is already running for this Project.',
        );
      }
      const candidateId = randomUUID();
      const startedAt = now().toISOString();
      const configurations: CandidateConfigurations = {
        designBrief: designBriefConfiguration(),
        conceptScreens: conceptScreenConfiguration(),
        prd: prdConfiguration(),
      };
      database.prepare(`
        INSERT INTO workflow_candidates (
          id, project_id, run_kind, status, current_stage, completed_operation_count,
          start_stage, insight_source, insight_revision_id, configuration_json,
          started_at, updated_at
        ) VALUES (?, ?, 'regeneration', 'running', 'design_brief', 0,
                  'design_brief', ?, ?, ?, ?, ?)
      `).run(
        candidateId,
        projectId,
        revision.insight_source,
        revision.id,
        JSON.stringify(configurations),
        startedAt,
        startedAt,
      );
      return continueFullCandidate(requireCandidate(projectId, candidateId));
    },

    discardInsightRevision(projectId) {
      requireProject(projectId);
      if (candidateRow(projectId)) {
        throw new WorkflowValidationError(
          'Discard the Candidate Workflow to discard its Insight Revision.',
        );
      }
      const result = database.prepare(
        'DELETE FROM insight_revisions WHERE project_id = ?',
      ).run(projectId);
      if (result.changes === 0) {
        throw new WorkflowValidationError('There is no Insight Revision to discard.');
      }
      return readProjectWorkflow(projectId);
    },

    async resumeFullWorkflow(projectId) {
      requireProject(projectId);
      const candidate = requireCandidate(projectId);
      if (
        candidate.status !== 'paused'
        && candidate.status !== 'failed'
        && candidate.status !== 'cancelled'
      ) {
        throw new WorkflowValidationError(
          'Only a paused, failed, or cancelled Candidate Workflow can be resumed.',
        );
      }
      if (activeFullRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'Full Generation is already running for this Project.',
        );
      }
      return continueFullCandidate(candidate);
    },

    promoteFullWorkflow(projectId) {
      requireProject(projectId);
      const candidate = requireCandidate(projectId);
      if (
        candidate.status !== 'awaiting_promotion'
        && candidate.status !== 'awaiting_warning_review'
        && candidate.status !== 'kept_after_warning_review'
      ) {
        throw new WorkflowValidationError(
          'The Candidate Workflow is not ready for promotion.',
        );
      }
      return promoteCandidate(candidate);
    },

    keepCandidateAfterWarningReview(projectId) {
      requireProject(projectId);
      const candidate = requireCandidate(projectId);
      if (candidate.status !== 'awaiting_warning_review') {
        throw new WorkflowValidationError(
          'The Candidate Workflow is not awaiting warning review.',
        );
      }
      updateCandidate(candidate.id, {
        status: 'kept_after_warning_review',
        error: null,
      });
      return readProjectWorkflow(projectId);
    },

    async discardFullWorkflow(projectId) {
      requireProject(projectId);
      const candidate = requireCandidate(projectId);
      if (activeFullRuns.has(projectId)) {
        throw new WorkflowValidationError(
          'Cancel Full Generation before discarding its Candidate Workflow.',
        );
      }
      const runIds = [
        candidate.design_brief_run_id,
        candidate.concept_screen_run_id,
        candidate.prd_run_id,
      ].filter((value): value is string => Boolean(value));
      const assetPaths = runIds.length === 0
        ? []
        : database.prepare(`
          SELECT relative_path FROM binary_assets
          WHERE run_id IN (${runIds.map(() => '?').join(', ')})
        `).all(...runIds) as unknown as Array<{ relative_path: string }>;
      database.exec('BEGIN IMMEDIATE;');
      try {
        database.prepare('DELETE FROM workflow_candidates WHERE id = ?').run(candidate.id);
        if (candidate.insight_revision_id) {
          database.prepare('DELETE FROM insight_revisions WHERE id = ?')
            .run(candidate.insight_revision_id);
        }
        database.prepare('DELETE FROM pending_cascades WHERE project_id = ?').run(projectId);
        const deleteRun = database.prepare('DELETE FROM stage_runs WHERE id = ?');
        runIds.forEach((runId) => deleteRun.run(runId));
        database.exec('COMMIT;');
      } catch (error) {
        database.exec('ROLLBACK;');
        throw error;
      }
      await Promise.all(assetPaths.map(({ relative_path: relativePath }) =>
        unlink(join(dataDirectory, relativePath)).catch(() => undefined)));
      return readProjectWorkflow(projectId);
    },

    cancelFullWorkflow(projectId) {
      requireProject(projectId);
      const active = activeFullRuns.get(projectId);
      if (!active) return false;
      active.cancelRequested = true;
      const conceptRun = activeConceptRuns.get(projectId);
      if (conceptRun) conceptRun.cancelRequested = true;
      return true;
    },

    cancelConceptScreens(projectId) {
      requireProject(projectId);
      const active = activeConceptRuns.get(projectId);
      if (!active) return false;
      active.cancelRequested = true;
      return true;
    },

    subscribeConceptScreenProgress(projectId, listener) {
      requireProject(projectId);
      const listeners = conceptProgressListeners.get(projectId) ?? new Set();
      listeners.add(listener);
      conceptProgressListeners.set(projectId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) conceptProgressListeners.delete(projectId);
      };
    },

    subscribeFullGenerationProgress(projectId, listener) {
      requireProject(projectId);
      const listeners = fullProgressListeners.get(projectId) ?? new Set();
      listeners.add(listener);
      fullProgressListeners.set(projectId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) fullProgressListeners.delete(projectId);
      };
    },

    close() {
      database.close();
    },
  };
  return service;
}
