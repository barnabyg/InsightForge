import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { strFromU8, unzipSync } from 'fflate';
import { buildApp } from './app.js';
import { createMockImageGeneration } from './mock-image-generation.js';
import { createMockTextGeneration } from './mock-text-generation.js';
import { StorageCapacityError } from './storage.js';

describe('Workflow HTTP API', () => {
  const temporaryDirectories: string[] = [];
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it('generates and retrieves a Design Brief through the public Project workflow resource', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({ dataDirectory, mode: 'mock' });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: {
        name: 'Confident retrofit choices',
        insightSource: 'Homeowners struggle to compare installer proposals and understand trade-offs.',
      },
    });
    const projectId = created.json().id as string;

    const before = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workflow`,
      headers: { host: 'localhost:4317' },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      projectId,
      canGenerateDesignBrief: true,
      designBrief: null,
      lastDesignBriefRun: null,
      designBriefConfiguration: { model: 'gpt-5.6-luna' },
    });

    const generated = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/design-brief-runs`,
      headers: { host: 'localhost:4317' },
    });
    expect(generated.statusCode).toBe(201);
    expect(generated.json()).toMatchObject({
      projectId,
      designBrief: {
        stageId: 'design_brief',
        markdown: expect.stringContaining('# Design Brief'),
        validation: { status: 'valid', warnings: [] },
      },
      lastDesignBriefRun: {
        status: 'succeeded',
        model: 'gpt-5.6-luna',
        responseId: expect.stringMatching(/^mock_resp_/),
        requestId: expect.stringMatching(/^mock_req_/),
      },
    });

    const retrieved = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workflow`,
      headers: { host: 'localhost:4317' },
    });
    expect(retrieved.json().designBrief).toEqual(generated.json().designBrief);
  });

  it('generates and retrieves a coordinated Concept Screen Set and its PNG assets', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({ dataDirectory, mode: 'mock' });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: {
        name: 'Coordinated comparison journey',
        insightSource: 'People need to compare options, inspect trade-offs, and record a choice.',
      },
    });
    const projectId = created.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/design-brief-runs`,
      headers: { host: 'localhost:4317' },
    });

    const generated = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/concept-screen-runs`,
      headers: { host: 'localhost:4317' },
    });

    expect(generated.statusCode).toBe(201);
    expect(generated.json()).toMatchObject({
      projectId,
      conceptScreenSet: {
        stageId: 'concept_screens',
        validation: { status: 'valid', screenCount: 3, width: 1024, height: 768 },
        screens: [
          { ordinal: 1, mediaType: 'image/png' },
          { ordinal: 2, mediaType: 'image/png' },
          { ordinal: 3, mediaType: 'image/png' },
        ],
      },
      lastConceptScreenRun: {
        status: 'succeeded',
        completedOperationCount: 3,
        operations: [
          { ordinal: 1, status: 'succeeded' },
          { ordinal: 2, status: 'succeeded' },
          { ordinal: 3, status: 'succeeded' },
        ],
      },
    });
    const screens = generated.json().conceptScreenSet.screens as Array<{
      downloadUrl: string;
    }>;
    for (const screen of screens) {
      const asset = await app.inject({
        method: 'GET',
        url: screen.downloadUrl,
        headers: { host: 'localhost:4317' },
      });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers['content-type']).toBe('image/png');
      expect(asset.rawPayload.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    }
  });

  it('blocks generation before OpenAI when local persistence is unsafe', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({
      dataDirectory,
      mode: 'mock',
      checkStorage: async () => {
        throw new StorageCapacityError(1024, 64 * 1024 * 1024);
      },
    });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: { insightSource: 'A safe generation must have durable local space.' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.json().id}/design-brief-runs`,
      headers: { host: 'localhost:4317' },
    });

    expect(response.statusCode).toBe(507);
    expect(response.json()).toEqual({
      code: 'insufficient_storage',
      error: 'Generation needs at least 64 MiB of free local storage; 1 KiB is available.',
    });
    const workflow = await app.inject({
      method: 'GET',
      url: `/api/projects/${created.json().id}/workflow`,
      headers: { host: 'localhost:4317' },
    });
    expect(workflow.json().lastDesignBriefRun).toBeNull();
  });

  async function generateAndPromoteFullWorkflow(
    app: FastifyInstance,
    projectId: string,
  ) {
    for (const path of [
      'full-generations',
      'full-generations/resume',
      'full-generations/resume',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/${path}`,
        headers: { host: 'localhost:4317' },
      });
      expect(response.statusCode).toBeLessThan(300);
    }
    return app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/full-generations/promotion`,
      headers: { host: 'localhost:4317' },
    });
  }

  it('keeps local work and portability available while OpenAI is unavailable', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    const seed = await buildApp({
      dataDirectory,
      mode: 'mock',
      textGeneration: createMockTextGeneration(),
      imageGeneration: createMockImageGeneration(),
    });
    const created = await seed.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: {
        name: 'Offline Project',
        insightSource: 'Local work must remain available through a network outage.',
      },
    });
    const projectId = created.json().id as string;
    await generateAndPromoteFullWorkflow(seed, projectId);
    const rerun = await seed.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/workflow-reruns`,
      headers: { host: 'localhost:4317' },
      payload: { stageId: 'prd' },
    });
    expect(rerun.statusCode).toBe(201);
    await seed.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/full-generations/promotion`,
      headers: { host: 'localhost:4317' },
    });
    await seed.close();

    const offline = await buildApp({
      dataDirectory,
      mode: 'live',
      apiKey: 'test-key',
      checkOpenAI: async () => ({
        state: 'unavailable',
        checkedAt: '2026-07-18T12:00:00.000Z',
        message: 'OpenAI could not be reached',
      }),
      textGeneration: createMockTextGeneration(),
      imageGeneration: createMockImageGeneration(),
    });
    apps.push(offline);
    await offline.ready();

    const workflow = await offline.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workflow`,
      headers: { host: 'localhost:4317' },
    });
    expect(workflow.statusCode).toBe(200);
    expect(workflow.json()).toMatchObject({
      designBrief: { stageId: 'design_brief' },
      conceptScreenSet: { stageId: 'concept_screens' },
      prd: { stageId: 'prd' },
      snapshots: [{ id: expect.any(String) }],
    });
    const snapshot = await offline.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workflow-snapshots/${workflow.json().snapshots[0].id}`,
      headers: { host: 'localhost:4317' },
    });
    expect(snapshot.statusCode).toBe(200);

    const configuration = await offline.inject({
      method: 'PUT',
      url: '/api/workflow-configuration/stages/design_brief/draft',
      headers: { host: 'localhost:4317' },
      payload: { prompt: 'An offline Prompt Draft' },
    });
    expect(configuration.statusCode).toBe(200);
    expect(configuration.json().stages[0].draftPrompt.prompt)
      .toBe('An offline Prompt Draft');

    const exported = await offline.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/export`,
      headers: { host: 'localhost:4317' },
    });
    expect(exported.statusCode).toBe(200);
    const imported = await offline.inject({
      method: 'POST',
      url: '/api/project-imports',
      headers: {
        host: 'localhost:4317',
        'content-type': 'application/zip',
      },
      payload: exported.rawPayload,
    });
    expect(imported.statusCode).toBe(201);

    const blocked = await offline.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/workflow-reruns`,
      headers: { host: 'localhost:4317' },
      payload: { stageId: 'prd' },
    });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json()).toEqual({
      code: 'openai_unavailable',
      error: 'OpenAI could not be reached',
    });
    const unchanged = await offline.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workflow`,
      headers: { host: 'localhost:4317' },
    });
    expect(unchanged.json().prd.id).toBe(workflow.json().prd.id);
  });

  it('generates and retrieves a PRD with its upstream lineage through the public workflow resource', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({ dataDirectory, mode: 'mock' });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: {
        name: 'Requirements from product intent',
        insightSource: 'People need to compare options, inspect trade-offs, and preserve a decision record.',
      },
    });
    const projectId = created.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/design-brief-runs`,
      headers: { host: 'localhost:4317' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/concept-screen-runs`,
      headers: { host: 'localhost:4317' },
    });

    const generated = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/prd-runs`,
      headers: { host: 'localhost:4317' },
    });

    expect(generated.statusCode).toBe(201);
    expect(generated.json()).toMatchObject({
      projectId,
      prd: {
        stageId: 'prd',
        markdown: expect.stringContaining('# Product Requirements Document'),
        validation: { status: 'valid', warnings: [] },
      },
      lastPrdRun: {
        stageId: 'prd',
        status: 'succeeded',
        model: 'gpt-5.6-luna',
        responseId: expect.stringMatching(/^mock_resp_/),
        requestId: expect.stringMatching(/^mock_req_/),
        stageInput: {
          designBrief: {
            artifactId: expect.any(String),
            runId: expect.any(String),
          },
          conceptScreenSet: {
            artifactId: expect.any(String),
            runId: expect.any(String),
            screens: [
              { ordinal: 1, assetId: expect.any(String) },
              { ordinal: 2, assetId: expect.any(String) },
              { ordinal: 3, assetId: expect.any(String) },
            ],
          },
        },
      },
    });
    expect(generated.json().lastPrdRun.stageInput).not.toHaveProperty('insightSource');

    const retrieved = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workflow`,
      headers: { host: 'localhost:4317' },
    });
    expect(retrieved.json().prd).toEqual(generated.json().prd);
  });

  it('generates the complete workflow atomically through Candidate Workflow commands', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({ dataDirectory, mode: 'mock' });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: {
        name: 'Atomic product workflow',
        insightSource: 'Authors need a single bounded action that produces a coherent product workflow.',
      },
    });
    const projectId = created.json().id as string;

    const afterDesignBrief = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/full-generations`,
      headers: { host: 'localhost:4317' },
    });
    expect(afterDesignBrief.json().candidate).toMatchObject({
      status: 'paused',
      currentStage: 'concept_screens',
    });
    const afterConceptScreens = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/full-generations/resume`,
      headers: { host: 'localhost:4317' },
    });
    expect(afterConceptScreens.json().candidate).toMatchObject({
      status: 'paused',
      currentStage: 'prd',
    });
    const awaitingPromotion = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/full-generations/resume`,
      headers: { host: 'localhost:4317' },
    });
    expect(awaitingPromotion.json().candidate).toMatchObject({
      status: 'awaiting_promotion',
      currentStage: 'promotion',
    });
    const generated = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/full-generations/promotion`,
      headers: { host: 'localhost:4317' },
    });

    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toMatchObject({
      projectId,
      candidate: null,
      designBrief: { stageId: 'design_brief' },
      conceptScreenSet: {
        stageId: 'concept_screens',
        screens: [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }],
      },
      prd: { stageId: 'prd' },
    });
  });

  it('creates, edits, and generates an Insight Revision through explicit commands', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({ dataDirectory, mode: 'mock' });
    apps.push(app);
    const originalInsight = 'Authors need a coherent way to compare candidate neighbourhoods.';
    const revisedInsight = 'Authors need to compare neighbourhoods, commutes, and accessibility.';
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: { name: 'Neighbourhood decisions', insightSource: originalInsight },
    });
    const projectId = created.json().id as string;
    const original = await generateAndPromoteFullWorkflow(app, projectId);

    const begun = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/insight-revisions`,
      headers: { host: 'localhost:4317' },
    });
    expect(begun.statusCode).toBe(201);
    expect(begun.json().insightRevision).toMatchObject({
      insightSource: originalInsight,
    });

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/insight-revisions/active`,
      headers: { host: 'localhost:4317' },
      payload: { insightSource: revisedInsight },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      insightRevision: { insightSource: revisedInsight },
      designBrief: { id: original.json().designBrief.id },
      conceptScreenSet: { id: original.json().conceptScreenSet.id },
      prd: { id: original.json().prd.id },
    });

    const invalidEdit = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/insight-revisions/active`,
      headers: { host: 'localhost:4317' },
      payload: { insightSource: 42 },
    });
    expect(invalidEdit.statusCode).toBe(400);
    expect(invalidEdit.json()).toEqual({
      code: 'invalid_input',
      error: 'Insight Revision must be text.',
    });

    const generation = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/insight-revisions/active/generation`,
      headers: { host: 'localhost:4317' },
    });
    expect(generation.statusCode).toBe(201);
    expect(generation.json()).toMatchObject({
      insightRevision: { insightSource: revisedInsight },
      designBrief: { id: original.json().designBrief.id },
      conceptScreenSet: { id: original.json().conceptScreenSet.id },
      prd: { id: original.json().prd.id },
      candidate: {
        runKind: 'regeneration',
        status: 'paused',
        currentStage: 'concept_screens',
      },
    });
    const currentProject = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
      headers: { host: 'localhost:4317' },
    });
    expect(currentProject.json().insightSource).toBe(originalInsight);
  });

  it('starts an explicitly chosen Variation Run through the public rerun command', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({ dataDirectory, mode: 'mock' });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: {
        name: 'Explicit PRD variation',
        insightSource: 'Authors want deliberate variation without mixing workflow generations.',
      },
    });
    const projectId = created.json().id as string;
    const original = await generateAndPromoteFullWorkflow(app, projectId);

    const variation = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/workflow-reruns`,
      headers: { host: 'localhost:4317' },
      payload: { stageId: 'prd' },
    });

    expect(variation.statusCode).toBe(201);
    expect(variation.json()).toMatchObject({
      prd: { id: original.json().prd.id },
      candidate: { runKind: 'variation', status: 'awaiting_promotion' },
    });
    const promoted = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/full-generations/promotion`,
      headers: { host: 'localhost:4317' },
    });
    expect(promoted.json()).toMatchObject({
      lastPrdRun: { runKind: 'variation' },
      snapshots: [{ replacedFromStage: 'prd' }],
    });
  });

  it('inspects, restores, and deletes Workflow Snapshots through explicit commands', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({ dataDirectory, mode: 'mock' });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: {
        name: 'Manage coherent history',
        insightSource: 'Authors need to inspect and deliberately restore coherent history.',
      },
    });
    const projectId = created.json().id as string;
    const original = await generateAndPromoteFullWorkflow(app, projectId);
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/workflow-reruns`,
      headers: { host: 'localhost:4317' },
      payload: { stageId: 'prd' },
    });
    const varied = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/full-generations/promotion`, headers: { host: 'localhost:4317' } });
    const snapshotId = varied.json().snapshots[0].id as string;

    const inspected = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workflow-snapshots/${snapshotId}`,
      headers: { host: 'localhost:4317' },
    });
    expect(inspected.statusCode).toBe(200);
    expect(inspected.json()).toMatchObject({
      id: snapshotId,
      prd: original.json().prd,
      prdRun: original.json().lastPrdRun,
    });

    const restored = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/workflow-snapshots/${snapshotId}/restoration`,
      headers: { host: 'localhost:4317' },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      prd: { markdown: original.json().prd.markdown },
      snapshots: [{ preservedBy: 'restoration' }, { id: snapshotId }],
    });
    expect(restored.json().prd.id).not.toBe(original.json().prd.id);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/workflow-snapshots/${snapshotId}`,
      headers: { host: 'localhost:4317' },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().snapshots).toHaveLength(1);
  });

  it('downloads the current deliverables as a named ZIP without an OpenAI check', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    let connectivityChecks = 0;
    const app = await buildApp({
      dataDirectory,
      mode: 'mock',
      checkOpenAI: async () => {
        connectivityChecks += 1;
        return {
          state: 'connected',
          message: 'Mock OpenAI is available.',
          checkedAt: '2026-07-17T08:00:00.000Z',
        };
      },
    });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: {
        name: 'Requirements from product intent',
        insightSource: 'People need to compare options and preserve a decision record.',
      },
    });
    const projectId = created.json().id as string;
    for (const path of ['design-brief-runs', 'concept-screen-runs', 'prd-runs']) {
      const generated = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/${path}`,
        headers: { host: 'localhost:4317' },
      });
      expect(generated.statusCode).toBe(201);
    }
    const checksAfterGeneration = connectivityChecks;

    const exported = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/deliverables`,
      headers: { host: 'localhost:4317' },
    });

    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toBe('application/zip');
    expect(exported.headers['content-disposition']).toBe(
      'attachment; filename="requirements-from-product-intent-deliverables.zip"',
    );
    expect(connectivityChecks).toBe(checksAfterGeneration);
    const files = unzipSync(exported.rawPayload);
    expect(strFromU8(files['design-brief.md'])).toContain('# Design Brief');
    expect(strFromU8(files['prd.md'])).toContain('# Product Requirements Document');
    expect(Object.keys(files)).toContain('manifest.json');
  });

  it('downloads a complete Project Export without generation or an OpenAI check', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    let connectivityChecks = 0;
    const app = await buildApp({
      dataDirectory,
      mode: 'mock',
      checkOpenAI: async () => {
        connectivityChecks += 1;
        return {
          state: 'connected',
          message: 'Mock OpenAI is available.',
          checkedAt: '2026-07-17T09:00:00.000Z',
        };
      },
    });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: {
        name: 'Portable Project',
        insightSource: 'This local Project must remain portable without OpenAI.',
      },
    });
    const projectId = created.json().id as string;
    const checksBeforeExport = connectivityChecks;

    const exported = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/export`,
      headers: { host: 'localhost:4317' },
    });

    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toBe('application/zip');
    expect(exported.headers['content-disposition']).toBe(
      'attachment; filename="portable-project-project-export.zip"',
    );
    expect(connectivityChecks).toBe(checksBeforeExport);
    const files = unzipSync(exported.rawPayload);
    expect(JSON.parse(strFromU8(files['manifest.json']))).toMatchObject({
      format: 'insightforge.project-export',
      schemaVersion: 1,
      project: { id: projectId, name: 'Portable Project' },
    });
    expect(JSON.parse(strFromU8(files['project.json']))).toMatchObject({
      schemaVersion: 1,
      project: {
        id: projectId,
        insightSource: 'This local Project must remain portable without OpenAI.',
      },
      currentWorkflow: { artifactIds: {} },
      workflowSnapshots: [],
      candidates: [],
      binaryAssets: [],
    });
  });

  it('imports a Project Export through a stable offline HTTP command', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    let connectivityChecks = 0;
    const app = await buildApp({
      dataDirectory,
      mode: 'mock',
      checkOpenAI: async () => {
        connectivityChecks += 1;
        return {
          state: 'connected',
          message: 'Mock OpenAI is available.',
          checkedAt: '2026-07-17T10:30:00.000Z',
        };
      },
    });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: {
        name: 'Offline Portable Project',
        insightSource: 'Import must not depend on OpenAI or cloud services.',
      },
    });
    const sourceId = created.json().id as string;
    const exported = await app.inject({
      method: 'GET',
      url: `/api/projects/${sourceId}/export`,
      headers: { host: 'localhost:4317' },
    });
    const checksBeforeImport = connectivityChecks;

    const imported = await app.inject({
      method: 'POST',
      url: '/api/project-imports',
      headers: {
        host: 'localhost:4317',
        'content-type': 'application/zip',
      },
      payload: exported.rawPayload,
    });

    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({
      id: expect.not.stringContaining(sourceId),
      name: 'Offline Portable Project (Imported)',
      insightSource: 'Import must not depend on OpenAI or cloud services.',
    });
    expect(connectivityChecks).toBe(checksBeforeImport);
    const library = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
    });
    expect(library.json()).toHaveLength(2);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/project-imports',
      headers: {
        host: 'localhost:4317',
        'content-type': 'application/zip',
      },
      payload: Buffer.from('not a Project Export'),
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      code: 'project_import_archive_invalid',
      error: 'The selected file is not a readable Project Export archive.',
    });
  });

  it('rolls back an HTTP import when asset persistence fails after writes begin', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-api-'));
    temporaryDirectories.push(dataDirectory);
    const plannedIds = Array.from({ length: 16 }, (_, index) =>
      `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
    const importedProjectId = plannedIds[0]!;
    const app = await buildApp({
      dataDirectory,
      mode: 'mock',
      generateImportId: () => plannedIds.shift()!,
    });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
      payload: {
        name: 'Rollback Source',
        insightSource: 'A failed import must not leave a partial Project.',
      },
    });
    const sourceId = created.json().id as string;
    for (const path of ['design-brief-runs', 'concept-screen-runs']) {
      const generated = await app.inject({
        method: 'POST',
        url: `/api/projects/${sourceId}/${path}`,
        headers: { host: 'localhost:4317' },
      });
      expect(generated.statusCode).toBe(201);
    }
    const exported = await app.inject({
      method: 'GET',
      url: `/api/projects/${sourceId}/export`,
      headers: { host: 'localhost:4317' },
    });
    const collidingDirectory = join(
      dataDirectory,
      'assets',
      `import-${importedProjectId}`,
    );
    await mkdir(collidingDirectory);
    await writeFile(join(collidingDirectory, 'existing.txt'), 'pre-existing');

    const imported = await app.inject({
      method: 'POST',
      url: '/api/project-imports',
      headers: {
        host: 'localhost:4317',
        'content-type': 'application/zip',
      },
      payload: exported.rawPayload,
    });

    expect(imported.statusCode).toBe(400);
    expect(imported.json()).toMatchObject({
      code: 'project_import_persistence_failed',
      error: expect.stringContaining('storage was left unchanged'),
    });
    const library = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { host: 'localhost:4317' },
    });
    expect(library.json()).toHaveLength(1);
    expect(library.json()[0]).toMatchObject({ id: sourceId, name: 'Rollback Source' });
  });

});
