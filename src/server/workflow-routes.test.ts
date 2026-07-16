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
});
