import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('local application bootstrap', () => {
  const temporaryDirectories: string[] = [];

  async function createTemporaryDataDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'insightforge-test-'));
    temporaryDirectories.push(directory);
    return directory;
  }

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('initializes local storage, reports safe mock connectivity, and rejects remote browser requests', async () => {
    const dataDirectory = await createTemporaryDataDirectory();

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
    const dataDirectory = await createTemporaryDataDirectory();

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

  it('starts on a real loopback listener while a live connectivity check runs in the background', async () => {
    const dataDirectory = await createTemporaryDataDirectory();

    const appResult = await Promise.race([
      buildApp({
        dataDirectory,
        mode: 'live',
        apiKey: 'test-key',
        checkOpenAI: () => new Promise(() => undefined),
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ]);

    expect(appResult).not.toBeNull();
    const app = appResult!;
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${address}/api/bootstrap`);

    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(response.status).toBe(200);
    expect((await response.json() as { connectivity: { state: string } }).connectivity.state)
      .toBe('checking');

    await app.close();
  });

  it('serves the built browser shell from Fastify', async () => {
    const dataDirectory = await createTemporaryDataDirectory();
    const webRoot = join(dataDirectory, 'web');
    await mkdir(webRoot);
    await writeFile(join(webRoot, 'index.html'), '<h1>Built InsightForge</h1>');
    await writeFile(join(dataDirectory, 'secret.txt'), 'must not be served');

    const app = await buildApp({ dataDirectory, mode: 'mock', webRoot });
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'localhost:4317' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Built InsightForge');
    expect(response.headers['content-type']).toContain('text/html');

    const traversal = await app.inject({
      method: 'GET',
      url: '/assets/%2e%2e%2fsecret.txt',
      headers: { host: 'localhost:4317' },
    });
    expect(traversal.statusCode).toBe(404);
    expect(traversal.body).not.toContain('must not be served');

    await app.close();
  });

  it('lets the browser await the one startup connectivity result without polling', async () => {
    const dataDirectory = await createTemporaryDataDirectory();
    let completeProbe: ((state: {
      state: 'connected';
      checkedAt: string;
      message: string;
    }) => void) | undefined;

    const app = await buildApp({
      dataDirectory,
      mode: 'live',
      apiKey: 'test-key',
      checkOpenAI: () => new Promise((resolve) => {
        completeProbe = resolve;
      }),
    });
    await app.ready();

    const resultRequest = app.inject({
      method: 'GET',
      url: '/api/connectivity',
      headers: { host: 'localhost:4317' },
    });
    completeProbe?.({
      state: 'connected',
      checkedAt: '2026-07-16T10:50:00.000Z',
      message: 'OpenAI is reachable',
    });
    const result = await resultRequest;

    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({
      state: 'connected',
      checkedAt: '2026-07-16T10:50:00.000Z',
      message: 'OpenAI is reachable',
    });

    await app.close();
  });

  it('rechecks OpenAI only when the browser requests a manual refresh', async () => {
    const dataDirectory = await createTemporaryDataDirectory();
    const probeResults = [
      {
        state: 'unavailable' as const,
        checkedAt: '2026-07-16T11:00:00.000Z',
        message: 'OpenAI could not be reached',
      },
      {
        state: 'connected' as const,
        checkedAt: '2026-07-16T11:05:00.000Z',
        message: 'OpenAI is reachable',
      },
    ];
    const app = await buildApp({
      dataDirectory,
      mode: 'live',
      apiKey: 'test-key',
      checkOpenAI: async () => {
        const result = probeResults.shift();
        if (!result) {
          throw new Error('Unexpected connectivity probe');
        }
        return result;
      },
    });
    await app.ready();

    const initial = await app.inject({
      method: 'GET',
      url: '/api/connectivity',
      headers: { host: 'localhost:4317' },
    });
    expect(initial.json().state).toBe('unavailable');

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/connectivity/refresh',
      headers: { host: 'localhost:4317' },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json()).toEqual({
      state: 'connected',
      checkedAt: '2026-07-16T11:05:00.000Z',
      message: 'OpenAI is reachable',
    });

    const bootstrap = await app.inject({
      method: 'GET',
      url: '/api/bootstrap',
      headers: { host: 'localhost:4317' },
    });
    expect(bootstrap.json().connectivity.state).toBe('connected');

    await app.close();
  });
});
