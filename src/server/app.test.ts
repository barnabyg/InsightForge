import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('local application bootstrap', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('initializes local storage, reports safe mock connectivity, and rejects remote browser requests', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-test-'));
    temporaryDirectories.push(dataDirectory);

    const app = await buildApp({
      dataDirectory,
      mode: 'mock',
      now: () => new Date('2026-07-16T09:30:00.000Z'),
    });

    const bootstrap = await app.inject({
      method: 'GET',
      url: '/api/bootstrap',
      headers: { host: '127.0.0.1:4317' },
    });

    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toEqual({
      app: { name: 'InsightForge', version: '0.1.0' },
      mode: 'mock',
      connectivity: {
        state: 'connected',
        checkedAt: '2026-07-16T09:30:00.000Z',
        message: 'Mock OpenAI is ready',
      },
      storage: { state: 'ready' },
    });
    expect(JSON.stringify(bootstrap.json())).not.toContain('apiKey');

    const remoteHost = await app.inject({
      method: 'GET',
      url: '/api/bootstrap',
      headers: { host: 'insightforge.example:4317' },
    });
    expect(remoteHost.statusCode).toBe(403);

    const remoteOrigin = await app.inject({
      method: 'GET',
      url: '/api/bootstrap',
      headers: {
        host: 'localhost:4317',
        origin: 'https://malicious.example',
      },
    });
    expect(remoteOrigin.statusCode).toBe(403);

    await app.close();
  });

  it('loads without an API key and reports generation as unavailable', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-test-'));
    temporaryDirectories.push(dataDirectory);

    const app = await buildApp({
      dataDirectory,
      mode: 'live',
      apiKey: '',
      now: () => new Date('2026-07-16T10:00:00.000Z'),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/bootstrap',
      headers: { host: 'localhost:4317' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().connectivity).toEqual({
      state: 'api_key_missing',
      checkedAt: '2026-07-16T10:00:00.000Z',
      message: 'Set OPENAI_API_KEY to enable generation',
    });
    expect(response.headers['set-cookie']).toBeUndefined();

    await app.close();
  });
});
