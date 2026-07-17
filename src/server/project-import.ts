import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { strFromU8, unzipSync } from 'fflate';
import { PNG } from 'pngjs';
import type {
  GeneratedStageId as StageId,
  RunKind,
} from '../shared/generation.js';
import type { Project } from '../shared/projects.js';

type StageKey = 'designBrief' | 'conceptScreens' | 'prd';

const stageIdByKey: Record<StageKey, StageId> = {
  designBrief: 'design_brief',
  conceptScreens: 'concept_screens',
  prd: 'prd',
};

interface ExportError {
  code: string;
  message: string;
}

interface ArtifactIds {
  designBrief?: string;
  conceptScreens?: string;
  prd?: string;
}

interface ProjectExportEnvelope {
  schemaVersion: 1;
  project: {
    id: string;
    name: string;
    insightSource: string;
    createdAt: string;
    updatedAt: string;
    nameIsAutomatic: boolean;
  };
  currentWorkflow: { artifactIds: ArtifactIds };
  workflowSnapshots: Array<{
    id: string;
    createdAt: string;
    preservedBy: 'promotion' | 'restoration';
    replacedFromStage: StageId;
    insightSource: string;
    artifactIds: ArtifactIds;
  }>;
  insightRevisions: Array<{
    id: string;
    projectId: string;
    insightSource: string;
    createdAt: string;
    updatedAt: string;
  }>;
  candidates: Array<{
    id: string;
    projectId: string;
    runKind: RunKind;
    status: string;
    currentStage: StageId | 'promotion';
    completedOperationCount: number;
    startStage: StageId;
    insightSource: string;
    insightRevisionId: string | null;
    configuration: Record<string, unknown>;
    designBriefRunId: string | null;
    designBriefArtifactId: string | null;
    conceptScreenRunId: string | null;
    conceptScreenArtifactId: string | null;
    prdRunId: string | null;
    prdArtifactId: string | null;
    warnings: unknown[];
    error: ExportError | null;
    startedAt: string;
    updatedAt: string;
  }>;
  pendingCascades: Array<{
    projectId: string;
    designBriefArtifactId: string;
    createdAt: string;
  }>;
  artifacts: Array<{
    id: string;
    projectId: string;
    stageId: StageId;
    runId: string;
    markdown: string;
    createdAt: string;
    validation: unknown;
  }>;
  stageRuns: Array<{
    id: string;
    projectId: string;
    stageId: StageId;
    runKind: RunKind;
    status: 'running' | 'succeeded' | 'failed';
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    prompt: string;
    model: string;
    stageConfigurationUpdatedAt: string;
    input: string;
    inputArtifactId: string | null;
    inputRunId: string | null;
    inputLineage: unknown;
    assembledRequest: string;
    settings: unknown;
    attemptHistory: unknown;
    responseId: string | null;
    requestId: string | null;
    usage: unknown;
    validation: unknown;
    error: ExportError | null;
  }>;
  conceptScreenOperations: Array<{
    runId: string;
    ordinal: 1 | 2 | 3;
    status: 'running' | 'succeeded' | 'failed';
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    assetId: string | null;
    responseId: string | null;
    requestId: string | null;
    usage: unknown;
    error: ExportError | null;
  }>;
  binaryAssets: Array<{
    id: string;
    projectId: string;
    runId: string;
    archivePath: string;
    mediaType: 'image/png';
    byteSize: number;
    width: number;
    height: number;
    createdAt: string;
  }>;
}

interface ProjectExportManifest {
  project: { id: string; name: string };
  integrity: {
    algorithm: 'sha256';
    files: Array<{ path: string; byteSize: number; sha256: string }>;
  };
}

export class ProjectImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProjectImportError';
    this.code = code;
  }
}

function invalidStructure(message: string): never {
  throw new ProjectImportError('project_import_structure_invalid', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) invalidStructure(`${label} must be an object.`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalidStructure(`${label} must be an array.`);
  return value;
}

function stringValue(value: unknown, label: string, allowEmpty = true): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    invalidStructure(`${label} must be ${allowEmpty ? 'text' : 'non-empty text'}.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return stringValue(value, label);
}

function numberValue(value: unknown, label: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidStructure(`${label} must be ${nullable ? 'a number or null' : 'a number'}.`);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    invalidStructure(`${label} has an unsupported value.`);
  }
  return value as T;
}

function errorValue(value: unknown, label: string): ExportError | null {
  if (value === null) return null;
  const item = record(value, label);
  return {
    code: stringValue(item.code, `${label}.code`, false),
    message: stringValue(item.message, `${label}.message`, false),
  };
}

function readJsonFile(files: Record<string, Uint8Array>, path: string): unknown {
  const bytes = files[path];
  if (!bytes) invalidStructure(`Project Export is missing ${path}.`);
  try {
    return JSON.parse(strFromU8(bytes)) as unknown;
  } catch {
    invalidStructure(`${path} is not valid JSON.`);
  }
}

function safeArchivePath(path: string): boolean {
  return path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && !path.split('/').some((part) => part === '..' || part === '');
}

function validateManifest(
  files: Record<string, Uint8Array>,
): ProjectExportManifest {
  const raw = record(readJsonFile(files, 'manifest.json'), 'manifest.json');
  if (raw.format !== 'insightforge.project-export') {
    throw new ProjectImportError(
      'project_import_format_invalid',
      'This file is not an InsightForge Project Export.',
    );
  }
  if (raw.schemaVersion !== 1) {
    throw new ProjectImportError(
      'project_import_version_unsupported',
      'This Project Export version is not supported by this version of InsightForge.',
    );
  }
  const contents = record(raw.contents, 'manifest.json contents');
  if (contents.project !== 'project.json' || contents.assets !== 'assets/') {
    invalidStructure('Project Export contents are not laid out as expected.');
  }
  const project = record(raw.project, 'manifest.json project');
  const integrity = record(raw.integrity, 'manifest.json integrity');
  if (integrity.algorithm !== 'sha256') {
    throw new ProjectImportError(
      'project_import_integrity_invalid',
      'Project Export uses an unsupported integrity algorithm.',
    );
  }
  const entries = array(integrity.files, 'manifest.json integrity files');
  const seen = new Set<string>();
  const validatedEntries = entries.map((entry, index) => {
    const item = record(entry, `integrity file ${index + 1}`);
    const path = stringValue(item.path, `integrity file ${index + 1} path`, false);
    const byteSize = numberValue(item.byteSize, `integrity file ${path} byteSize`)!;
    const sha256 = stringValue(item.sha256, `integrity file ${path} sha256`, false);
    if (!safeArchivePath(path) || path === 'manifest.json' || seen.has(path)) {
      invalidStructure(`Integrity metadata contains an invalid or duplicate path: ${path}.`);
    }
    if (!Number.isInteger(byteSize) || byteSize < 0 || !/^[a-f0-9]{64}$/.test(sha256)) {
      invalidStructure(`Integrity metadata for ${path} is invalid.`);
    }
    seen.add(path);
    const bytes = files[path];
    if (!bytes) {
      throw new ProjectImportError(
        'project_import_integrity_invalid',
        `Project Export is missing integrity-protected file ${path}.`,
      );
    }
    if (
      bytes.byteLength !== byteSize
      || createHash('sha256').update(bytes).digest('hex') !== sha256
    ) {
      throw new ProjectImportError(
        'project_import_integrity_invalid',
        `Project Export file ${path} failed its integrity check.`,
      );
    }
    return { path, byteSize, sha256 };
  });
  const archivePaths = Object.keys(files).sort();
  const declaredPaths = ['manifest.json', ...seen].sort();
  if (
    archivePaths.length !== declaredPaths.length
    || archivePaths.some((path, index) => path !== declaredPaths[index])
  ) {
    throw new ProjectImportError(
      'project_import_integrity_invalid',
      'Project Export contains files that are missing from its integrity metadata.',
    );
  }
  return {
    project: {
      id: stringValue(project.id, 'manifest.json project id', false),
      name: stringValue(project.name, 'manifest.json project name', false),
    },
    integrity: { algorithm: 'sha256', files: validatedEntries },
  };
}

function artifactIds(value: unknown, label: string): ArtifactIds {
  const item = record(value, label);
  const allowed = new Set<StageKey>(['designBrief', 'conceptScreens', 'prd']);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key as StageKey)) invalidStructure(`${label} contains unknown stage ${key}.`);
    stringValue(item[key], `${label}.${key}`, false);
  }
  return item as ArtifactIds;
}

function validateConfiguration(value: unknown, label: string): Record<string, unknown> {
  const configuration = record(value, label);
  for (const key of ['designBrief', 'conceptScreens', 'prd'] as const) {
    const stage = record(configuration[key], `${label}.${key}`);
    stringValue(stage.prompt, `${label}.${key}.prompt`);
    stringValue(stage.model, `${label}.${key}.model`, false);
    stringValue(stage.updated_at, `${label}.${key}.updated_at`, false);
    if (key === 'conceptScreens') {
      enumValue(stage.image_quality, ['low', 'medium', 'high'], `${label}.${key}.image_quality`);
    } else if (stage.image_quality !== null) {
      invalidStructure(`${label}.${key}.image_quality must be null.`);
    }
  }
  return configuration;
}

function parseProjectExport(
  files: Record<string, Uint8Array>,
  manifest: ProjectExportManifest,
): ProjectExportEnvelope {
  const raw = record(readJsonFile(files, 'project.json'), 'project.json');
  if (raw.schemaVersion !== 1) {
    throw new ProjectImportError(
      'project_import_version_unsupported',
      'The Project data version is not supported by this version of InsightForge.',
    );
  }
  const sourceProject = record(raw.project, 'project.json project');
  const nameIsAutomatic = sourceProject.nameIsAutomatic;
  if (typeof nameIsAutomatic !== 'boolean') {
    invalidStructure('Project nameIsAutomatic must be a boolean.');
  }
  const project = {
    id: stringValue(sourceProject.id, 'project id', false),
    name: stringValue(sourceProject.name, 'project name', false),
    insightSource: stringValue(sourceProject.insightSource, 'Project Insight Source'),
    createdAt: stringValue(sourceProject.createdAt, 'Project createdAt', false),
    updatedAt: stringValue(sourceProject.updatedAt, 'Project updatedAt', false),
    nameIsAutomatic,
  };
  if (manifest.project.id !== project.id || manifest.project.name !== project.name) {
    invalidStructure('The manifest Project identity does not match project.json.');
  }
  const currentWorkflow = record(raw.currentWorkflow, 'currentWorkflow');
  const stages = ['design_brief', 'concept_screens', 'prd'] as const;
  const runKinds = ['initial', 'regeneration', 'variation'] as const;
  const runStatuses = ['running', 'succeeded', 'failed'] as const;
  const candidateStatuses = [
    'running', 'paused', 'failed', 'cancelled', 'awaiting_promotion',
    'awaiting_warning_review', 'kept_after_warning_review',
  ] as const;
  const candidateStages = [...stages, 'promotion'] as const;

  const workflowSnapshots = array(raw.workflowSnapshots, 'workflowSnapshots').map((value, index) => {
    const item = record(value, `workflowSnapshots[${index}]`);
    return {
      id: stringValue(item.id, `workflowSnapshots[${index}].id`, false),
      createdAt: stringValue(item.createdAt, `workflowSnapshots[${index}].createdAt`, false),
      preservedBy: enumValue(item.preservedBy, ['promotion', 'restoration'], `workflowSnapshots[${index}].preservedBy`),
      replacedFromStage: enumValue(item.replacedFromStage, stages, `workflowSnapshots[${index}].replacedFromStage`),
      insightSource: stringValue(item.insightSource, `workflowSnapshots[${index}].insightSource`),
      artifactIds: artifactIds(item.artifactIds, `workflowSnapshots[${index}].artifactIds`),
    };
  });
  const insightRevisions = array(raw.insightRevisions, 'insightRevisions').map((value, index) => {
    const item = record(value, `insightRevisions[${index}]`);
    return {
      id: stringValue(item.id, `insightRevisions[${index}].id`, false),
      projectId: stringValue(item.projectId, `insightRevisions[${index}].projectId`, false),
      insightSource: stringValue(item.insightSource, `insightRevisions[${index}].insightSource`),
      createdAt: stringValue(item.createdAt, `insightRevisions[${index}].createdAt`, false),
      updatedAt: stringValue(item.updatedAt, `insightRevisions[${index}].updatedAt`, false),
    };
  });
  const candidates = array(raw.candidates, 'candidates').map((value, index) => {
    const item = record(value, `candidates[${index}]`);
    return {
      id: stringValue(item.id, `candidates[${index}].id`, false),
      projectId: stringValue(item.projectId, `candidates[${index}].projectId`, false),
      runKind: enumValue(item.runKind, runKinds, `candidates[${index}].runKind`),
      status: enumValue(item.status, candidateStatuses, `candidates[${index}].status`),
      currentStage: enumValue(item.currentStage, candidateStages, `candidates[${index}].currentStage`),
      completedOperationCount: numberValue(item.completedOperationCount, `candidates[${index}].completedOperationCount`)! ,
      startStage: enumValue(item.startStage, stages, `candidates[${index}].startStage`),
      insightSource: stringValue(item.insightSource, `candidates[${index}].insightSource`),
      insightRevisionId: nullableString(item.insightRevisionId, `candidates[${index}].insightRevisionId`),
      configuration: validateConfiguration(item.configuration, `candidates[${index}].configuration`),
      designBriefRunId: nullableString(item.designBriefRunId, `candidates[${index}].designBriefRunId`),
      designBriefArtifactId: nullableString(item.designBriefArtifactId, `candidates[${index}].designBriefArtifactId`),
      conceptScreenRunId: nullableString(item.conceptScreenRunId, `candidates[${index}].conceptScreenRunId`),
      conceptScreenArtifactId: nullableString(item.conceptScreenArtifactId, `candidates[${index}].conceptScreenArtifactId`),
      prdRunId: nullableString(item.prdRunId, `candidates[${index}].prdRunId`),
      prdArtifactId: nullableString(item.prdArtifactId, `candidates[${index}].prdArtifactId`),
      warnings: array(item.warnings, `candidates[${index}].warnings`),
      error: errorValue(item.error, `candidates[${index}].error`),
      startedAt: stringValue(item.startedAt, `candidates[${index}].startedAt`, false),
      updatedAt: stringValue(item.updatedAt, `candidates[${index}].updatedAt`, false),
    };
  });
  if (candidates.length > 1) invalidStructure('A Project Export cannot contain multiple active candidates.');
  const pendingCascades = array(raw.pendingCascades, 'pendingCascades').map((value, index) => {
    const item = record(value, `pendingCascades[${index}]`);
    return {
      projectId: stringValue(item.projectId, `pendingCascades[${index}].projectId`, false),
      designBriefArtifactId: stringValue(item.designBriefArtifactId, `pendingCascades[${index}].designBriefArtifactId`, false),
      createdAt: stringValue(item.createdAt, `pendingCascades[${index}].createdAt`, false),
    };
  });
  if (pendingCascades.length > 1) invalidStructure('A Project Export cannot contain multiple pending cascades.');
  const artifacts = array(raw.artifacts, 'artifacts').map((value, index) => {
    const item = record(value, `artifacts[${index}]`);
    return {
      id: stringValue(item.id, `artifacts[${index}].id`, false),
      projectId: stringValue(item.projectId, `artifacts[${index}].projectId`, false),
      stageId: enumValue(item.stageId, stages, `artifacts[${index}].stageId`),
      runId: stringValue(item.runId, `artifacts[${index}].runId`, false),
      markdown: stringValue(item.markdown, `artifacts[${index}].markdown`),
      createdAt: stringValue(item.createdAt, `artifacts[${index}].createdAt`, false),
      validation: record(item.validation, `artifacts[${index}].validation`),
    };
  });
  const stageRuns = array(raw.stageRuns, 'stageRuns').map((value, index) => {
    const item = record(value, `stageRuns[${index}]`);
    return {
      id: stringValue(item.id, `stageRuns[${index}].id`, false),
      projectId: stringValue(item.projectId, `stageRuns[${index}].projectId`, false),
      stageId: enumValue(item.stageId, stages, `stageRuns[${index}].stageId`),
      runKind: enumValue(item.runKind, runKinds, `stageRuns[${index}].runKind`),
      status: enumValue(item.status, runStatuses, `stageRuns[${index}].status`),
      startedAt: stringValue(item.startedAt, `stageRuns[${index}].startedAt`, false),
      completedAt: nullableString(item.completedAt, `stageRuns[${index}].completedAt`),
      durationMs: numberValue(item.durationMs, `stageRuns[${index}].durationMs`, true),
      prompt: stringValue(item.prompt, `stageRuns[${index}].prompt`),
      model: stringValue(item.model, `stageRuns[${index}].model`, false),
      stageConfigurationUpdatedAt: stringValue(item.stageConfigurationUpdatedAt, `stageRuns[${index}].stageConfigurationUpdatedAt`, false),
      input: stringValue(item.input, `stageRuns[${index}].input`),
      inputArtifactId: nullableString(item.inputArtifactId, `stageRuns[${index}].inputArtifactId`),
      inputRunId: nullableString(item.inputRunId, `stageRuns[${index}].inputRunId`),
      inputLineage: item.inputLineage,
      assembledRequest: stringValue(item.assembledRequest, `stageRuns[${index}].assembledRequest`),
      settings: item.settings,
      attemptHistory: item.attemptHistory,
      responseId: nullableString(item.responseId, `stageRuns[${index}].responseId`),
      requestId: nullableString(item.requestId, `stageRuns[${index}].requestId`),
      usage: item.usage,
      validation: item.validation,
      error: errorValue(item.error, `stageRuns[${index}].error`),
    };
  });
  const conceptScreenOperations = array(raw.conceptScreenOperations, 'conceptScreenOperations').map((value, index) => {
    const item = record(value, `conceptScreenOperations[${index}]`);
    return {
      runId: stringValue(item.runId, `conceptScreenOperations[${index}].runId`, false),
      ordinal: enumValue(item.ordinal?.toString(), ['1', '2', '3'], `conceptScreenOperations[${index}].ordinal`) as unknown as 1 | 2 | 3,
      status: enumValue(item.status, runStatuses, `conceptScreenOperations[${index}].status`),
      startedAt: stringValue(item.startedAt, `conceptScreenOperations[${index}].startedAt`, false),
      completedAt: nullableString(item.completedAt, `conceptScreenOperations[${index}].completedAt`),
      durationMs: numberValue(item.durationMs, `conceptScreenOperations[${index}].durationMs`, true),
      assetId: nullableString(item.assetId, `conceptScreenOperations[${index}].assetId`),
      responseId: nullableString(item.responseId, `conceptScreenOperations[${index}].responseId`),
      requestId: nullableString(item.requestId, `conceptScreenOperations[${index}].requestId`),
      usage: item.usage,
      error: errorValue(item.error, `conceptScreenOperations[${index}].error`),
    };
  });
  for (const operation of conceptScreenOperations) {
    operation.ordinal = Number(operation.ordinal) as 1 | 2 | 3;
  }
  const binaryAssets = array(raw.binaryAssets, 'binaryAssets').map((value, index) => {
    const item = record(value, `binaryAssets[${index}]`);
    return {
      id: stringValue(item.id, `binaryAssets[${index}].id`, false),
      projectId: stringValue(item.projectId, `binaryAssets[${index}].projectId`, false),
      runId: stringValue(item.runId, `binaryAssets[${index}].runId`, false),
      archivePath: stringValue(item.archivePath, `binaryAssets[${index}].archivePath`, false),
      mediaType: enumValue(item.mediaType, ['image/png'], `binaryAssets[${index}].mediaType`),
      byteSize: numberValue(item.byteSize, `binaryAssets[${index}].byteSize`)! ,
      width: numberValue(item.width, `binaryAssets[${index}].width`)! ,
      height: numberValue(item.height, `binaryAssets[${index}].height`)! ,
      createdAt: stringValue(item.createdAt, `binaryAssets[${index}].createdAt`, false),
    };
  });
  return {
    schemaVersion: 1,
    project,
    currentWorkflow: { artifactIds: artifactIds(currentWorkflow.artifactIds, 'currentWorkflow.artifactIds') },
    workflowSnapshots,
    insightRevisions,
    candidates,
    pendingCascades,
    artifacts,
    stageRuns,
    conceptScreenOperations,
    binaryAssets,
  };
}

function requireReference(map: Map<string, unknown>, id: string | null, label: string): void {
  if (id !== null && !map.has(id)) invalidStructure(`${label} references missing identifier ${id}.`);
}

function validateReferences(payload: ProjectExportEnvelope, files: Record<string, Uint8Array>): void {
  const allIds = new Set([payload.project.id]);
  const uniqueId = (id: string, label: string) => {
    if (allIds.has(id)) invalidStructure(`${label} duplicates identifier ${id}.`);
    allIds.add(id);
  };
  const runs = new Map(payload.stageRuns.map((run) => [run.id, run]));
  const artifacts = new Map(payload.artifacts.map((artifact) => [artifact.id, artifact]));
  const revisions = new Map(payload.insightRevisions.map((revision) => [revision.id, revision]));
  const assets = new Map(payload.binaryAssets.map((asset) => [asset.id, asset]));
  payload.stageRuns.forEach((run) => uniqueId(run.id, 'Stage Run'));
  payload.artifacts.forEach((artifact) => uniqueId(artifact.id, 'Artifact'));
  payload.insightRevisions.forEach((revision) => uniqueId(revision.id, 'Insight Revision'));
  payload.candidates.forEach((candidate) => uniqueId(candidate.id, 'Candidate Workflow'));
  payload.workflowSnapshots.forEach((snapshot) => uniqueId(snapshot.id, 'Workflow Snapshot'));
  payload.binaryAssets.forEach((asset) => uniqueId(asset.id, 'binary asset'));
  const projectOwned = [
    ...payload.stageRuns, ...payload.artifacts, ...payload.insightRevisions,
    ...payload.candidates, ...payload.pendingCascades, ...payload.binaryAssets,
  ];
  if (projectOwned.some((item) => item.projectId !== payload.project.id)) {
    invalidStructure('Project Export contains records owned by a different Project.');
  }
  for (const run of payload.stageRuns) {
    requireReference(artifacts, run.inputArtifactId, `Stage Run ${run.id} inputArtifactId`);
    requireReference(runs, run.inputRunId, `Stage Run ${run.id} inputRunId`);
  }
  for (const artifact of payload.artifacts) {
    const run = runs.get(artifact.runId);
    if (!run || run.stageId !== artifact.stageId) {
      invalidStructure(`Artifact ${artifact.id} does not reference a matching Stage Run.`);
    }
  }
  const validateArtifactSet = (ids: ArtifactIds, label: string) => {
    for (const [key, id] of Object.entries(ids) as Array<[StageKey, string]>) {
      const artifact = artifacts.get(id);
      if (!artifact || artifact.stageId !== stageIdByKey[key]) {
        invalidStructure(`${label}.${key} does not reference a matching Artifact.`);
      }
    }
  };
  for (const candidate of payload.candidates) {
    requireReference(revisions, candidate.insightRevisionId, `Candidate ${candidate.id} insightRevisionId`);
    requireReference(runs, candidate.designBriefRunId, `Candidate ${candidate.id} designBriefRunId`);
    requireReference(artifacts, candidate.designBriefArtifactId, `Candidate ${candidate.id} designBriefArtifactId`);
    requireReference(runs, candidate.conceptScreenRunId, `Candidate ${candidate.id} conceptScreenRunId`);
    requireReference(artifacts, candidate.conceptScreenArtifactId, `Candidate ${candidate.id} conceptScreenArtifactId`);
    requireReference(runs, candidate.prdRunId, `Candidate ${candidate.id} prdRunId`);
    requireReference(artifacts, candidate.prdArtifactId, `Candidate ${candidate.id} prdArtifactId`);
  }
  for (const pending of payload.pendingCascades) {
    requireReference(artifacts, pending.designBriefArtifactId, 'Pending cascade designBriefArtifactId');
  }
  const operationKeys = new Set<string>();
  for (const operation of payload.conceptScreenOperations) {
    const run = runs.get(operation.runId);
    if (!run || run.stageId !== 'concept_screens') {
      invalidStructure('Concept Screen operation does not reference a Concept Screens Stage Run.');
    }
    const key = `${operation.runId}:${operation.ordinal}`;
    if (operationKeys.has(key)) invalidStructure(`Concept Screen operation ${key} is duplicated.`);
    operationKeys.add(key);
    if (operation.status === 'succeeded' && !operation.assetId) {
      invalidStructure(`Successful Concept Screen operation ${key} is missing its asset.`);
    }
    requireReference(assets, operation.assetId, `Concept Screen operation ${key} assetId`);
    if (operation.assetId && assets.get(operation.assetId)!.runId !== operation.runId) {
      invalidStructure(`Concept Screen operation ${key} references an asset from another run.`);
    }
  }
  const successfulConceptOperations = (runId: string, label: string) => {
    const operations = payload.conceptScreenOperations
      .filter((operation) => operation.runId === runId && operation.status === 'succeeded')
      .sort((left, right) => left.ordinal - right.ordinal);
    if (
      operations.length !== 3
      || operations.some((operation, index) =>
        operation.ordinal !== index + 1 || operation.assetId === null)
    ) {
      invalidStructure(`${label} does not contain three usable Concept Screen assets.`);
    }
    return operations as Array<typeof operations[number] & { assetId: string }>;
  };
  const requireSucceededArtifact = (id: string, stageId: StageId, label: string) => {
    const artifact = artifacts.get(id);
    const run = artifact ? runs.get(artifact.runId) : undefined;
    if (!artifact || artifact.stageId !== stageId || !run || run.status !== 'succeeded') {
      invalidStructure(`${label} does not reference a successful ${stageId} Artifact.`);
    }
    if (stageId === 'concept_screens') {
      successfulConceptOperations(run.id, label);
    }
    return { artifact, run };
  };
  const validatePrdLineage = (
    run: ProjectExportEnvelope['stageRuns'][number],
    designBriefId: string,
    conceptScreensId: string,
    label: string,
  ) => {
    const designBrief = artifacts.get(designBriefId)!;
    const conceptScreens = artifacts.get(conceptScreensId)!;
    if (run.inputArtifactId !== designBriefId || run.inputRunId !== designBrief.runId) {
      invalidStructure(`${label} PRD does not consume its Design Brief.`);
    }
    const lineage = record(run.inputLineage, `${label} PRD input lineage`);
    const designLineage = record(lineage.designBrief, `${label} PRD Design Brief lineage`);
    const conceptLineage = record(
      lineage.conceptScreenSet,
      `${label} PRD Concept Screen Set lineage`,
    );
    if (
      designLineage.artifactId !== designBriefId
      || designLineage.runId !== designBrief.runId
      || conceptLineage.artifactId !== conceptScreensId
      || conceptLineage.runId !== conceptScreens.runId
    ) {
      invalidStructure(`${label} PRD lineage does not match its upstream Artifacts.`);
    }
    const operations = successfulConceptOperations(conceptScreens.runId, label);
    const screens = array(conceptLineage.screens, `${label} PRD Concept Screen lineage`)
      .map((screen, index) => record(screen, `${label} PRD screen ${index + 1}`));
    if (
      screens.length !== 3
      || screens.some((screen, index) =>
        screen.ordinal !== index + 1 || screen.assetId !== operations[index]!.assetId)
    ) {
      invalidStructure(`${label} PRD Concept Screen lineage is inconsistent.`);
    }
  };
  const validateCoherentWorkflow = (ids: ArtifactIds, insightSource: string, label: string) => {
    validateArtifactSet(ids, `${label}.artifactIds`);
    if (ids.conceptScreens && !ids.designBrief) {
      invalidStructure(`${label} has Concept Screens without a Design Brief.`);
    }
    if (ids.prd && (!ids.designBrief || !ids.conceptScreens)) {
      invalidStructure(`${label} has a PRD without its complete upstream workflow.`);
    }
    const design = ids.designBrief
      ? requireSucceededArtifact(ids.designBrief, 'design_brief', `${label} Design Brief`)
      : null;
    if (design && design.run.input !== insightSource) {
      invalidStructure(`${label} Design Brief does not consume its Insight Source.`);
    }
    const concept = ids.conceptScreens
      ? requireSucceededArtifact(ids.conceptScreens, 'concept_screens', `${label} Concept Screens`)
      : null;
    if (
      concept && design
      && (
        concept.run.inputArtifactId !== design.artifact.id
        || concept.run.inputRunId !== design.run.id
        || concept.run.input !== design.artifact.markdown
      )
    ) {
      invalidStructure(`${label} Concept Screens do not consume its Design Brief.`);
    }
    const prd = ids.prd
      ? requireSucceededArtifact(ids.prd, 'prd', `${label} PRD`)
      : null;
    if (prd && design && concept) {
      validatePrdLineage(
        prd.run,
        design.artifact.id,
        concept.artifact.id,
        label,
      );
    }
  };
  const validateCandidatePair = (
    runId: string | null,
    artifactId: string | null,
    stageId: StageId,
    label: string,
  ) => {
    const run = runId ? runs.get(runId) : undefined;
    const artifact = artifactId ? artifacts.get(artifactId) : undefined;
    if (runId && (!run || run.stageId !== stageId)) {
      invalidStructure(`${label} Run does not reference the expected stage.`);
    }
    if (
      artifactId
      && (!artifact || artifact.stageId !== stageId || !run || artifact.runId !== run.id)
    ) {
      invalidStructure(`${label} does not reference a matching Artifact and Stage Run.`);
    }
  };
  for (const candidate of payload.candidates) {
    const label = `Candidate Workflow ${candidate.id}`;
    validateCandidatePair(
      candidate.designBriefRunId,
      candidate.designBriefArtifactId,
      'design_brief',
      `${label} Design Brief`,
    );
    validateCandidatePair(
      candidate.conceptScreenRunId,
      candidate.conceptScreenArtifactId,
      'concept_screens',
      `${label} Concept Screens`,
    );
    validateCandidatePair(
      candidate.prdRunId,
      candidate.prdArtifactId,
      'prd',
      `${label} PRD`,
    );
    const candidateArtifacts: ArtifactIds = {
      ...(candidate.designBriefArtifactId
        ? { designBrief: candidate.designBriefArtifactId }
        : {}),
      ...(candidate.conceptScreenArtifactId
        ? { conceptScreens: candidate.conceptScreenArtifactId }
        : {}),
      ...(candidate.prdArtifactId ? { prd: candidate.prdArtifactId } : {}),
    };
    validateCoherentWorkflow(candidateArtifacts, candidate.insightSource, label);
    if (candidate.currentStage !== 'design_brief' && !candidate.designBriefArtifactId) {
      invalidStructure(`${label} is missing the Design Brief needed to resume.`);
    }
    if (
      (candidate.currentStage === 'prd' || candidate.currentStage === 'promotion')
      && !candidate.conceptScreenArtifactId
    ) {
      invalidStructure(`${label} is missing the Concept Screen Set needed to resume.`);
    }
    if (candidate.currentStage === 'promotion' && !candidate.prdArtifactId) {
      invalidStructure(`${label} is missing the PRD needed for promotion.`);
    }
    const completedRange = {
      design_brief: [0, 0],
      concept_screens: [1, 4],
      prd: [4, 5],
      promotion: [5, 5],
    } as const;
    const [minimumCompleted, maximumCompleted] = completedRange[candidate.currentStage];
    if (
      !Number.isInteger(candidate.completedOperationCount)
      || candidate.completedOperationCount < minimumCompleted
      || candidate.completedOperationCount > maximumCompleted
    ) {
      invalidStructure(`${label} completed operation count does not match its current stage.`);
    }
  }
  for (const pending of payload.pendingCascades) {
    requireSucceededArtifact(
      pending.designBriefArtifactId,
      'design_brief',
      'Pending cascade Design Brief',
    );
  }
  validateCoherentWorkflow(
    payload.currentWorkflow.artifactIds,
    payload.project.insightSource,
    'currentWorkflow',
  );
  for (const snapshot of payload.workflowSnapshots) {
    validateCoherentWorkflow(
      snapshot.artifactIds,
      snapshot.insightSource,
      `Workflow Snapshot ${snapshot.id}`,
    );
  }
  for (const artifact of payload.artifacts) {
    if (artifact.stageId === 'concept_screens') {
      successfulConceptOperations(artifact.runId, `Concept Screen Artifact ${artifact.id}`);
    }
  }
  const assetPaths = new Set<string>();
  for (const asset of payload.binaryAssets) {
    const run = runs.get(asset.runId);
    if (!run || run.stageId !== 'concept_screens') {
      invalidStructure(`Binary asset ${asset.id} does not reference a Concept Screens Stage Run.`);
    }
    if (!safeArchivePath(asset.archivePath) || !asset.archivePath.startsWith('assets/')) {
      invalidStructure(`Binary asset ${asset.id} has an invalid archive path.`);
    }
    if (assetPaths.has(asset.archivePath)) invalidStructure(`Binary asset path ${asset.archivePath} is duplicated.`);
    assetPaths.add(asset.archivePath);
    const bytes = files[asset.archivePath];
    if (!bytes || bytes.byteLength !== asset.byteSize) {
      throw new ProjectImportError(
        'project_import_asset_invalid',
        `Concept Screen asset ${asset.archivePath} has an invalid byte size.`,
      );
    }
    let png: PNG;
    try {
      png = PNG.sync.read(Buffer.from(bytes), { checkCRC: true });
    } catch {
      throw new ProjectImportError(
        'project_import_asset_invalid',
        `Concept Screen asset ${asset.archivePath} is not a valid PNG.`,
      );
    }
    if (png.width !== asset.width || png.height !== asset.height) {
      throw new ProjectImportError(
        'project_import_asset_invalid',
        `Concept Screen asset ${asset.archivePath} dimensions do not match its metadata.`,
      );
    }
  }
  const protectedAssetPaths = new Set(
    Object.keys(files).filter((path) => path.startsWith('assets/')),
  );
  if (
    protectedAssetPaths.size !== assetPaths.size
    || [...protectedAssetPaths].some((path) => !assetPaths.has(path))
  ) {
    invalidStructure('Project Export asset files do not match its binary asset metadata.');
  }
}

function collisionSafeName(database: DatabaseSync, requestedName: string): string {
  const base = requestedName.trim().slice(0, 120);
  const exists = (name: string) => Boolean(database.prepare(
    'SELECT 1 FROM projects WHERE name = ? LIMIT 1',
  ).get(name));
  if (!exists(base)) return base;
  for (let copy = 1; ; copy += 1) {
    const suffix = copy === 1 ? ' (Imported)' : ` (Imported ${copy})`;
    const candidate = `${base.slice(0, 120 - suffix.length)}${suffix}`;
    if (!exists(candidate)) return candidate;
  }
}

function idMap<T extends { id: string }>(
  records: T[],
  generateId: () => string,
): Map<string, string> {
  return new Map(records.map(({ id }) => [id, generateId()]));
}

function remapNullable(map: Map<string, string>, value: string | null): string | null {
  return value === null ? null : map.get(value)!;
}

function remapJsonIds(
  value: unknown,
  maps: Array<Map<string, string>>,
): unknown {
  if (typeof value === 'string') {
    for (const map of maps) {
      const replacement = map.get(value);
      if (replacement) return replacement;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => remapJsonIds(item, maps));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      remapJsonIds(item, maps),
    ]));
  }
  return value;
}

function json(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

export function importProjectExport(
  database: DatabaseSync,
  dataDirectory: string,
  archive: Buffer,
  importedAt: Date,
  generateId: () => string = randomUUID,
): Project {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch {
    throw new ProjectImportError(
      'project_import_archive_invalid',
      'The selected file is not a readable Project Export archive.',
    );
  }
  const manifest = validateManifest(files);
  const payload = parseProjectExport(files, manifest);
  validateReferences(payload, files);

  const projectId = generateId();
  const name = collisionSafeName(database, payload.project.name);
  const timestamp = importedAt.toISOString();
  const runIds = idMap(payload.stageRuns, generateId);
  const artifactIds = idMap(payload.artifacts, generateId);
  const revisionIds = idMap(payload.insightRevisions, generateId);
  const candidateIds = idMap(payload.candidates, generateId);
  const snapshotIds = idMap(payload.workflowSnapshots, generateId);
  const assetIds = idMap(payload.binaryAssets, generateId);
  const remapMaps = [runIds, artifactIds, revisionIds, candidateIds, snapshotIds, assetIds];
  const importDirectoryName = `import-${projectId}`;
  const stagingDirectory = join(dataDirectory, 'assets', `.${importDirectoryName}`);
  const finalDirectory = join(dataDirectory, 'assets', importDirectoryName);
  let transactionStarted = false;
  let assetsMoved = false;

  try {
    if (payload.binaryAssets.length > 0) {
      mkdirSync(stagingDirectory, { recursive: false });
      for (const asset of payload.binaryAssets) {
        writeFileSync(join(stagingDirectory, `${assetIds.get(asset.id)!}.png`), files[asset.archivePath]!, {
          flag: 'wx',
        });
      }
    }
    database.exec('BEGIN IMMEDIATE;');
    transactionStarted = true;
    database.prepare(`
      INSERT INTO projects (id, name, insight_source, created_at, updated_at, name_is_automatic)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(projectId, name, payload.project.insightSource, timestamp, timestamp);
    const insertRun = database.prepare(`
      INSERT INTO stage_runs (
        id, project_id, stage_id, run_kind, status, started_at, completed_at,
        duration_ms, prompt_snapshot, model_snapshot, stage_configuration_updated_at,
        input_snapshot, input_artifact_id, input_run_id, input_lineage_json,
        assembled_request, settings_json, attempt_history_json, response_id,
        request_id, usage_json, validation_json, error_code, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const run of payload.stageRuns) {
      insertRun.run(
        runIds.get(run.id)!, projectId, run.stageId, run.runKind, run.status,
        run.startedAt, run.completedAt, run.durationMs, run.prompt, run.model,
        run.stageConfigurationUpdatedAt, run.input,
        remapNullable(artifactIds, run.inputArtifactId),
        remapNullable(runIds, run.inputRunId),
        json(remapJsonIds(run.inputLineage, remapMaps)), run.assembledRequest,
        json(run.settings), json(remapJsonIds(run.attemptHistory, remapMaps)),
        run.responseId, run.requestId, json(run.usage), json(run.validation),
        run.error?.code ?? null, run.error?.message ?? null,
      );
    }
    const insertArtifact = database.prepare(`
      INSERT INTO artifacts (id, project_id, stage_id, run_id, markdown, created_at, validation_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const artifact of payload.artifacts) {
      insertArtifact.run(
        artifactIds.get(artifact.id)!, projectId, artifact.stageId,
        runIds.get(artifact.runId)!, artifact.markdown, artifact.createdAt,
        JSON.stringify(artifact.validation),
      );
    }
    const insertAsset = database.prepare(`
      INSERT INTO binary_assets (
        id, project_id, run_id, relative_path, media_type, byte_size, width, height, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const asset of payload.binaryAssets) {
      const nextAssetId = assetIds.get(asset.id)!;
      insertAsset.run(
        nextAssetId, projectId, runIds.get(asset.runId)!,
        join('assets', importDirectoryName, `${nextAssetId}.png`),
        asset.mediaType, asset.byteSize, asset.width, asset.height, asset.createdAt,
      );
    }
    const insertOperation = database.prepare(`
      INSERT INTO concept_screen_operations (
        run_id, ordinal, status, started_at, completed_at, duration_ms, asset_id,
        response_id, request_id, usage_json, error_code, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const operation of payload.conceptScreenOperations) {
      insertOperation.run(
        runIds.get(operation.runId)!, operation.ordinal, operation.status,
        operation.startedAt, operation.completedAt, operation.durationMs,
        remapNullable(assetIds, operation.assetId), operation.responseId,
        operation.requestId, json(operation.usage), operation.error?.code ?? null,
        operation.error?.message ?? null,
      );
    }
    const insertCurrent = database.prepare(`
      INSERT INTO current_artifacts (project_id, stage_id, artifact_id) VALUES (?, ?, ?)
    `);
    for (const [key, oldArtifactId] of Object.entries(
      payload.currentWorkflow.artifactIds,
    ) as Array<[StageKey, string]>) {
      insertCurrent.run(projectId, stageIdByKey[key], artifactIds.get(oldArtifactId)!);
    }
    const insertSnapshot = database.prepare(`
      INSERT INTO workflow_snapshots (
        id, project_id, created_at, preserved_by, replaced_from_stage, insight_source,
        design_brief_artifact_id, concept_screen_artifact_id, prd_artifact_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const snapshot of payload.workflowSnapshots) {
      insertSnapshot.run(
        snapshotIds.get(snapshot.id)!, projectId, snapshot.createdAt,
        snapshot.preservedBy, snapshot.replacedFromStage, snapshot.insightSource,
        snapshot.artifactIds.designBrief
          ? artifactIds.get(snapshot.artifactIds.designBrief)! : null,
        snapshot.artifactIds.conceptScreens
          ? artifactIds.get(snapshot.artifactIds.conceptScreens)! : null,
        snapshot.artifactIds.prd ? artifactIds.get(snapshot.artifactIds.prd)! : null,
      );
    }
    const insertRevision = database.prepare(`
      INSERT INTO insight_revisions (id, project_id, insight_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const revision of payload.insightRevisions) {
      insertRevision.run(
        revisionIds.get(revision.id)!, projectId, revision.insightSource,
        revision.createdAt, revision.updatedAt,
      );
    }
    const insertCandidate = database.prepare(`
      INSERT INTO workflow_candidates (
        id, project_id, run_kind, status, current_stage, completed_operation_count,
        start_stage, insight_source, insight_revision_id, configuration_json,
        design_brief_run_id, design_brief_artifact_id, concept_screen_run_id,
        concept_screen_artifact_id, prd_run_id, prd_artifact_id, warnings_json,
        error_code, error_message, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const candidate of payload.candidates) {
      insertCandidate.run(
        candidateIds.get(candidate.id)!, projectId, candidate.runKind,
        candidate.status, candidate.currentStage, candidate.completedOperationCount,
        candidate.startStage, candidate.insightSource,
        remapNullable(revisionIds, candidate.insightRevisionId),
        JSON.stringify(candidate.configuration),
        remapNullable(runIds, candidate.designBriefRunId),
        remapNullable(artifactIds, candidate.designBriefArtifactId),
        remapNullable(runIds, candidate.conceptScreenRunId),
        remapNullable(artifactIds, candidate.conceptScreenArtifactId),
        remapNullable(runIds, candidate.prdRunId),
        remapNullable(artifactIds, candidate.prdArtifactId),
        JSON.stringify(remapJsonIds(candidate.warnings, remapMaps)),
        candidate.error?.code ?? null, candidate.error?.message ?? null,
        candidate.startedAt, candidate.updatedAt,
      );
    }
    const insertPending = database.prepare(`
      INSERT INTO pending_cascades (project_id, design_brief_artifact_id, created_at)
      VALUES (?, ?, ?)
    `);
    for (const pending of payload.pendingCascades) {
      insertPending.run(
        projectId, artifactIds.get(pending.designBriefArtifactId)!, pending.createdAt,
      );
    }
    if (payload.binaryAssets.length > 0) {
      renameSync(stagingDirectory, finalDirectory);
      assetsMoved = true;
    }
    database.exec('COMMIT;');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try {
        database.exec('ROLLBACK;');
      } catch {
        // The original import failure remains the actionable error.
      }
    }
    rmSync(assetsMoved ? finalDirectory : stagingDirectory, { recursive: true, force: true });
    if (error instanceof ProjectImportError) throw error;
    throw new ProjectImportError(
      'project_import_persistence_failed',
      `Project import could not be saved; storage was left unchanged. ${
        error instanceof Error ? error.message : ''
      }`.trim(),
    );
  }
  return {
    id: projectId,
    name,
    insightSource: payload.project.insightSource,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
