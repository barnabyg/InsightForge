import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { generatedStageIds } from '../shared/generation.js';
import type {
  ConceptScreenOrdinal,
  GeneratedStageId,
  PrdRun,
  RunKind,
  WorkflowChangeKind,
  WorkflowFingerprint,
  WorkflowRerunPlan,
} from '../shared/generation.js';
import type { ImageQuality } from '../shared/workflow-configuration.js';

interface ArtifactRow {
  id: string;
  run_id: string;
  markdown: string;
}

interface ConfigurationRow {
  prompt: string;
  model: string;
  image_quality: ImageQuality | null;
}

interface RunRow {
  run_kind: RunKind;
  input_snapshot: string;
  input_lineage_json: string | null;
  prompt_snapshot: string;
  model_snapshot: string;
  settings_json: string | null;
}

interface ConceptOperationRow {
  asset_id: string;
  ordinal: ConceptScreenOrdinal;
  width: number;
  height: number;
}

const workflowChangeMessages: Record<WorkflowChangeKind, string> = {
  input: 'The Stage Input changed since the current Artifact was generated.',
  prompt: 'The shared Stage Prompt changed since the current Artifact was generated.',
  model: 'The selected model changed since the current Artifact was generated.',
  settings: 'The generation settings changed since the current Artifact was generated.',
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function workflowFingerprint(parts: {
  input: string;
  prompt: string;
  model: string;
  settings: string;
}): WorkflowFingerprint {
  const fingerprint = {
    input: sha256(parts.input),
    prompt: sha256(parts.prompt),
    model: sha256(parts.model),
    settings: sha256(parts.settings),
  };
  return {
    ...fingerprint,
    combined: sha256(JSON.stringify(fingerprint)),
  };
}

export function storedRunFingerprint(
  run: Pick<RunRow,
    'input_snapshot' | 'input_lineage_json' | 'prompt_snapshot'
    | 'model_snapshot' | 'settings_json'>,
  stageId: GeneratedStageId,
): WorkflowFingerprint {
  return workflowFingerprint({
    input: stageId === 'prd'
      ? run.input_lineage_json ?? run.input_snapshot
      : run.input_snapshot,
    prompt: run.prompt_snapshot,
    model: run.model_snapshot,
    settings: run.settings_json ?? 'null',
  });
}

export function buildPrdStageInput(
  designBrief: { id: string; run_id: string; markdown: string },
  conceptScreenSet: { id: string; run_id: string },
  operations: Array<{
    asset_id: string | null;
    ordinal: ConceptScreenOrdinal;
    width: number | null;
    height: number | null;
  }>,
): PrdRun['stageInput'] {
  return {
    designBrief: {
      value: designBrief.markdown,
      artifactId: designBrief.id,
      runId: designBrief.run_id,
    },
    conceptScreenSet: {
      artifactId: conceptScreenSet.id,
      runId: conceptScreenSet.run_id,
      screens: operations.map((operation) => ({
        assetId: operation.asset_id!,
        ordinal: operation.ordinal,
        width: operation.width!,
        height: operation.height!,
      })),
    },
  };
}

function currentArtifact(
  database: DatabaseSync,
  projectId: string,
  stageId: GeneratedStageId,
): ArtifactRow | undefined {
  return database.prepare(`
    SELECT artifact.id, artifact.run_id, artifact.markdown
    FROM current_artifacts AS current
    JOIN artifacts AS artifact ON artifact.id = current.artifact_id
    WHERE current.project_id = ? AND current.stage_id = ?
  `).get(projectId, stageId) as unknown as ArtifactRow | undefined;
}

function stageFingerprints(
  database: DatabaseSync,
  projectId: string,
  stageId: GeneratedStageId,
): { previous: WorkflowFingerprint; current: WorkflowFingerprint } | null {
  const artifact = currentArtifact(database, projectId, stageId);
  if (!artifact) return null;
  const run = database.prepare('SELECT * FROM stage_runs WHERE id = ?')
    .get(artifact.run_id) as unknown as RunRow | undefined;
  const configuration = database.prepare(`
    SELECT prompt, model, image_quality
    FROM stage_configurations
    WHERE stage_id = ?
  `).get(stageId) as unknown as ConfigurationRow | undefined;
  if (!run || !configuration) return null;

  let currentInput: string;
  let currentSettings = 'null';
  if (stageId === 'design_brief') {
    const project = database.prepare('SELECT insight_source FROM projects WHERE id = ?')
      .get(projectId) as unknown as { insight_source: string } | undefined;
    if (!project) return null;
    currentInput = project.insight_source;
  } else if (stageId === 'concept_screens') {
    const designBrief = currentArtifact(database, projectId, 'design_brief');
    if (!designBrief) return null;
    currentInput = designBrief.markdown;
    currentSettings = JSON.stringify({ imageQuality: configuration.image_quality });
  } else {
    const designBrief = currentArtifact(database, projectId, 'design_brief');
    const conceptScreenSet = currentArtifact(database, projectId, 'concept_screens');
    if (!designBrief || !conceptScreenSet) return null;
    const operations = database.prepare(`
      SELECT operation.asset_id, operation.ordinal, asset.width, asset.height
      FROM concept_screen_operations AS operation
      JOIN binary_assets AS asset ON asset.id = operation.asset_id
      WHERE operation.run_id = ? AND operation.status = 'succeeded'
      ORDER BY operation.ordinal
    `).all(conceptScreenSet.run_id) as unknown as ConceptOperationRow[];
    currentInput = JSON.stringify(buildPrdStageInput(
      designBrief,
      conceptScreenSet,
      operations,
    ));
  }

  return {
    previous: storedRunFingerprint(run, stageId),
    current: workflowFingerprint({
      input: currentInput,
      prompt: configuration.prompt,
      model: configuration.model,
      settings: currentSettings,
    }),
  };
}

export function readWorkflowRerunPlan(
  database: DatabaseSync,
  projectId: string,
): WorkflowRerunPlan | null {
  const changes: WorkflowRerunPlan['changes'] = [];
  const fingerprints = new Map<GeneratedStageId, {
    previous: WorkflowFingerprint;
    current: WorkflowFingerprint;
  }>();
  for (const stageId of generatedStageIds) {
    const stage = stageFingerprints(database, projectId, stageId);
    if (!stage) continue;
    fingerprints.set(stageId, stage);
    for (const kind of ['input', 'prompt', 'model', 'settings'] as const) {
      if (stage.previous[kind] !== stage.current[kind]) {
        changes.push({ stageId, kind, message: workflowChangeMessages[kind] });
      }
    }
  }
  const earliestChangedStage = generatedStageIds.find((stageId) =>
    changes.some((change) => change.stageId === stageId));
  if (!earliestChangedStage) return null;
  return {
    earliestChangedStage,
    affectedStages: generatedStageIds.slice(generatedStageIds.indexOf(earliestChangedStage)),
    changes,
    fingerprints: generatedStageIds
      .filter((stageId) => changes.some((change) => change.stageId === stageId))
      .map((stageId) => ({ stageId, ...fingerprints.get(stageId)! })),
  };
}
