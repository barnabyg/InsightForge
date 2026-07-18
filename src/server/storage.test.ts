import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockTextGeneration } from './mock-text-generation.js';
import {
  initializeStorage,
  ensureStorageCapacity,
  readStorageUsage,
  StorageCapacityError,
  StorageInitializationError,
} from './storage.js';
import { openWorkflowService } from './workflow-service.js';

describe('local storage durability', () => {
  const temporaryDirectories: string[] = [];

  async function createDataDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'insightforge-storage-'));
    temporaryDirectories.push(directory);
    return directory;
  }

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it('recovers abandoned operations and removes only unreferenced assets', async () => {
    const dataDirectory = await createDataDirectory();
    await initializeStorage(dataDirectory);
    const database = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
    database.exec('PRAGMA foreign_keys = ON;');
    const projectId = randomUUID();
    const runId = randomUUID();
    const assetId = randomUUID();
    const referencedPath = join('assets', `${assetId}.png`);
    const orphanPath = join(dataDirectory, 'assets', `${randomUUID()}.png`);
    const startedAt = '2026-07-18T08:00:00.000Z';
    database.prepare(`
      INSERT INTO projects (id, name, insight_source, created_at, updated_at)
      VALUES (?, 'Recovered Project', 'A durable idea', ?, ?)
    `).run(projectId, startedAt, startedAt);
    database.prepare(`
      INSERT INTO stage_runs (
        id, project_id, stage_id, status, started_at, prompt_snapshot,
        model_snapshot, stage_configuration_updated_at, input_snapshot,
        assembled_request
      ) VALUES (?, ?, 'concept_screens', 'running', ?, 'prompt', 'gpt-image-2', ?,
                'brief', 'assembled')
    `).run(runId, projectId, startedAt, startedAt);
    database.prepare(`
      INSERT INTO binary_assets (
        id, project_id, run_id, relative_path, media_type, byte_size,
        width, height, created_at
      ) VALUES (?, ?, ?, ?, 'image/png', 4, 1, 1, ?)
    `).run(assetId, projectId, runId, referencedPath, startedAt);
    database.prepare(`
      INSERT INTO concept_screen_operations (run_id, ordinal, status, started_at, asset_id)
      VALUES (?, 1, 'running', ?, ?)
    `).run(runId, startedAt, assetId);
    database.close();
    await writeFile(join(dataDirectory, referencedPath), Buffer.from('kept'));
    await writeFile(orphanPath, Buffer.from('orphan'));

    const state = await initializeStorage(dataDirectory, {
      now: () => new Date('2026-07-18T09:15:00.000Z'),
    });

    expect(state.recovery).toEqual({
      abandonedOperations: 1,
      abandonedStageRuns: 1,
      abandonedCandidates: 0,
      orphanAssetsRemoved: 1,
    });
    expect(existsSync(join(dataDirectory, referencedPath))).toBe(true);
    expect(existsSync(orphanPath)).toBe(false);

    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: createMockTextGeneration(),
    });
    try {
      expect(workflows.getProjectWorkflow(projectId).lastConceptScreenRun)
        .toMatchObject({
          status: 'failed',
          completedAt: '2026-07-18T09:15:00.000Z',
          error: {
            code: 'generation_interrupted',
            message: 'Generation was interrupted before this Stage Run completed.',
          },
          operations: [{
            ordinal: 1,
            status: 'failed',
            completedAt: '2026-07-18T09:15:00.000Z',
            error: {
              code: 'generation_interrupted',
              message: 'Generation was interrupted before this operation completed.',
            },
          }],
        });
    } finally {
      workflows.close();
    }
  });

  it('reports the data location and referenced asset usage by Project and in total', async () => {
    const dataDirectory = await createDataDirectory();
    await initializeStorage(dataDirectory);
    const database = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
    const projectId = randomUUID();
    const runId = randomUUID();
    const assetId = randomUUID();
    const timestamp = '2026-07-18T10:00:00.000Z';
    const relativePath = join('assets', `${assetId}.png`);
    database.prepare(`
      INSERT INTO projects (id, name, insight_source, created_at, updated_at)
      VALUES (?, 'Storage Project', '', ?, ?)
    `).run(projectId, timestamp, timestamp);
    database.prepare(`
      INSERT INTO stage_runs (
        id, project_id, stage_id, status, started_at, completed_at,
        prompt_snapshot, model_snapshot, stage_configuration_updated_at,
        input_snapshot, assembled_request
      ) VALUES (?, ?, 'concept_screens', 'succeeded', ?, ?, 'prompt',
                'gpt-image-2', ?, 'brief', 'assembled')
    `).run(runId, projectId, timestamp, timestamp, timestamp);
    database.prepare(`
      INSERT INTO binary_assets (
        id, project_id, run_id, relative_path, media_type, byte_size,
        width, height, created_at
      ) VALUES (?, ?, ?, ?, 'image/png', 5, 1, 1, ?)
    `).run(assetId, projectId, runId, relativePath, timestamp);
    database.close();
    await writeFile(join(dataDirectory, relativePath), Buffer.from('12345'));

    const artifactId = randomUUID();
    const artifactDatabase = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
    artifactDatabase.prepare(`
      INSERT INTO artifacts (
        id, project_id, stage_id, run_id, markdown, created_at, validation_json
      ) VALUES (?, ?, 'concept_screens', ?, 'relationship payload', ?, '{}')
    `).run(artifactId, projectId, runId, timestamp);
    artifactDatabase.close();
    const contentOnly = await readStorageUsage(dataDirectory);

    const relationshipDatabase = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
    relationshipDatabase.prepare(`
      INSERT INTO current_artifacts (project_id, stage_id, artifact_id)
      VALUES (?, 'concept_screens', ?)
    `).run(projectId, artifactId);
    relationshipDatabase.prepare(`
      INSERT INTO pending_cascades (project_id, design_brief_artifact_id, created_at)
      VALUES (?, ?, ?)
    `).run(projectId, artifactId, timestamp);
    relationshipDatabase.prepare(`
      INSERT INTO concept_screen_operations (
        run_id, ordinal, status, started_at, completed_at, asset_id
      ) VALUES (?, 1, 'succeeded', ?, ?, ?)
    `).run(runId, timestamp, timestamp, assetId);
    relationshipDatabase.close();
    const usage = await readStorageUsage(dataDirectory);

    expect(usage.state).toBe('ready');
    expect(usage.dataDirectory).toBe(dataDirectory);
    expect(usage.assetBytes).toBe(5);
    expect(usage.databaseBytes).toBeGreaterThan(0);
    expect(usage.totalBytes).toBe(usage.databaseBytes + 5);
    expect(usage.availableBytes).toBeGreaterThan(0);
    expect(usage.projects).toEqual([{
      projectId,
      name: 'Storage Project',
      estimatedBytes: expect.any(Number),
      structuredBytes: expect.any(Number),
      assetBytes: 5,
    }]);
    expect(usage.projects[0]!.structuredBytes).toBeGreaterThan(0);
    expect(usage.projects[0]!.structuredBytes)
      .toBeGreaterThan(contentOnly.projects[0]!.structuredBytes);
    expect(usage.projects[0]!.estimatedBytes)
      .toBe(usage.projects[0]!.structuredBytes + 5);
  });

  it('rejects startup when durable metadata references a missing asset', async () => {
    const dataDirectory = await createDataDirectory();
    await initializeStorage(dataDirectory);
    const database = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
    const projectId = randomUUID();
    const runId = randomUUID();
    const assetId = randomUUID();
    const timestamp = '2026-07-18T11:00:00.000Z';
    database.prepare(`
      INSERT INTO projects (id, name, insight_source, created_at, updated_at)
      VALUES (?, 'Broken Project', '', ?, ?)
    `).run(projectId, timestamp, timestamp);
    database.prepare(`
      INSERT INTO stage_runs (
        id, project_id, stage_id, status, started_at, completed_at,
        prompt_snapshot, model_snapshot, stage_configuration_updated_at,
        input_snapshot, assembled_request
      ) VALUES (?, ?, 'concept_screens', 'succeeded', ?, ?, 'prompt',
                'gpt-image-2', ?, 'brief', 'assembled')
    `).run(runId, projectId, timestamp, timestamp, timestamp);
    database.prepare(`
      INSERT INTO binary_assets (
        id, project_id, run_id, relative_path, media_type, byte_size,
        width, height, created_at
      ) VALUES (?, ?, ?, ?, 'image/png', 5, 1, 1, ?)
    `).run(assetId, projectId, runId, join('assets', `${assetId}.png`), timestamp);
    database.close();

    await expect(initializeStorage(dataDirectory)).rejects.toMatchObject({
      name: StorageInitializationError.name,
      code: 'storage_unusable',
    });
  });

  it('rejects a newer local schema without rewriting its version', async () => {
    const dataDirectory = await createDataDirectory();
    await initializeStorage(dataDirectory);
    const database = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
    database.prepare(`
      UPDATE app_metadata SET value = '999' WHERE key = 'schema_version'
    `).run();
    database.close();

    await expect(initializeStorage(dataDirectory)).rejects.toMatchObject({
      name: StorageInitializationError.name,
      code: 'storage_unusable',
    });
    await expect(initializeStorage(dataDirectory)).rejects.toMatchObject({
      name: StorageInitializationError.name,
      code: 'storage_unusable',
    });
  });

  it('blocks new persistence before the safety reserve is exhausted', async () => {
    const dataDirectory = await createDataDirectory();
    await initializeStorage(dataDirectory);

    await expect(ensureStorageCapacity(
      dataDirectory,
      Number.MAX_SAFE_INTEGER,
    )).rejects.toMatchObject({
      name: StorageCapacityError.name,
      code: 'insufficient_storage',
    });
    await expect(ensureStorageCapacity(dataDirectory, 1)).resolves.toBeUndefined();
  });
});
