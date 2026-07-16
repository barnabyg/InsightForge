import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('Project HTTP API', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('manages the complete Project lifecycle through localhost requests', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-api-'));
    temporaryDirectories.push(dataDirectory);
    let currentTime = '2026-07-16T14:00:00.000Z';
    const app = await buildApp({
      dataDirectory,
      mode: 'mock',
      now: () => new Date(currentTime),
    });

    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { insightSource: 'Help people compare complex policies.' },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json();
    expect(created).toMatchObject({
      name: 'Help people compare complex policies.',
      insightSource: 'Help people compare complex policies.',
    });

    currentTime = '2026-07-16T14:01:00.000Z';
    const updatedResponse = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}`,
      payload: { insightSource: 'Help people compare policies without jargon.' },
    });
    expect(updatedResponse.statusCode).toBe(200);
    expect(updatedResponse.json()).toMatchObject({
      name: 'Help people compare policies without jargon.',
      insightSource: 'Help people compare policies without jargon.',
    });

    currentTime = '2026-07-16T14:02:00.000Z';
    const renamedResponse = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}`,
      payload: { name: 'Policy lens' },
    });
    expect(renamedResponse.statusCode).toBe(200);
    expect(renamedResponse.json().name).toBe('Policy lens');

    currentTime = '2026-07-16T14:03:00.000Z';
    const duplicatedResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.id}/duplicate`,
    });
    expect(duplicatedResponse.statusCode).toBe(201);
    const duplicate = duplicatedResponse.json();
    expect(duplicate).toMatchObject({
      name: 'Policy lens — Copy',
      insightSource: 'Help people compare policies without jargon.',
    });

    const libraryResponse = await app.inject({
      method: 'GET',
      url: '/api/projects',
    });
    expect(libraryResponse.statusCode).toBe(200);
    expect(libraryResponse.json().map(({ id }: { id: string }) => id)).toEqual([
      duplicate.id,
      created.id,
    ]);

    const loadedResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}`,
    });
    expect(loadedResponse.json().name).toBe('Policy lens');

    const invalidRename = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}`,
      payload: { name: '   ' },
    });
    expect(invalidRename.statusCode).toBe(400);
    expect(invalidRename.json()).toEqual({
      error: 'Project name cannot be empty',
    });

    const deletedResponse = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${duplicate.id}`,
    });
    expect(deletedResponse.statusCode).toBe(204);
    expect((await app.inject({
      method: 'GET',
      url: `/api/projects/${duplicate.id}`,
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}`,
    })).statusCode).toBe(200);

    await app.close();
  });
});
