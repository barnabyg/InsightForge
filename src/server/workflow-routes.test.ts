import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';

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
});
