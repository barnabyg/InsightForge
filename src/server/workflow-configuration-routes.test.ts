import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('Workflow Configuration HTTP API', () => {
  const temporaryDirectories: string[] = [];
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('manages shared configuration, model choices, and portable JSON through localhost', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-config-api-'));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({
      dataDirectory,
      mode: 'mock',
      now: () => new Date('2026-07-16T16:00:00.000Z'),
    });
    apps.push(app);

    const initial = await app.inject({
      method: 'GET',
      url: '/api/workflow-configuration',
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().stages).toHaveLength(3);

    const drafted = await app.inject({
      method: 'PUT',
      url: '/api/workflow-configuration/stages/design_brief/draft',
      payload: { prompt: 'Prioritise behavioural evidence and explicit assumptions.' },
    });
    expect(drafted.statusCode).toBe(200);
    expect(drafted.json().stages[0].draftPrompt.prompt)
      .toBe('Prioritise behavioural evidence and explicit assumptions.');
    expect(drafted.json().stages[0].prompt).not
      .toBe('Prioritise behavioural evidence and explicit assumptions.');

    const saved = await app.inject({
      method: 'POST',
      url: '/api/workflow-configuration/stages/design_brief/save',
      payload: {
        prompt: 'Prioritise behavioural evidence and explicit assumptions.',
        model: 'gpt-5.4-mini',
        imageQuality: null,
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().stages[0]).toMatchObject({
      prompt: 'Prioritise behavioural evidence and explicit assumptions.',
      model: 'gpt-5.4-mini',
      draftPrompt: null,
      requiredInputs: ['insight_source'],
    });

    const models = await app.inject({ method: 'GET', url: '/api/models' });
    expect(models.statusCode).toBe(200);
    expect(models.json()).toEqual({
      text: ['gpt-5.6-luna'],
      multimodalText: ['gpt-5.6-luna'],
      image: ['gpt-image-2'],
      source: 'mock',
      checkedAt: '2026-07-16T16:00:00.000Z',
    });

    const exported = await app.inject({
      method: 'GET',
      url: '/api/workflow-configuration/export',
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json()).toMatchObject({ schemaVersion: 1 });
    expect(JSON.stringify(exported.json())).not.toContain('draft');

    const reset = await app.inject({
      method: 'POST',
      url: '/api/workflow-configuration/stages/design_brief/reset',
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().stages[0].model).toBe('gpt-5.6-luna');

    const imported = await app.inject({
      method: 'POST',
      url: '/api/workflow-configuration/import',
      payload: exported.json(),
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().stages[0].model).toBe('gpt-5.4-mini');

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/workflow-configuration/import',
      payload: { schemaVersion: 99, stages: [] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      error: 'Unsupported Workflow Configuration schema version',
    });
    expect((await app.inject({
      method: 'GET',
      url: '/api/workflow-configuration',
    })).json().stages[0].model).toBe('gpt-5.4-mini');

    await app.close();
    apps.splice(apps.indexOf(app), 1);
  });
});
