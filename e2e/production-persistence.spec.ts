import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { expect, test } from '@playwright/test';

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not allocate a loopback port.');
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startProductionServer(
  dataDirectory: string,
  port: number,
): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/server/main.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INSIGHTFORGE_DATA_DIR: dataDirectory,
        INSIGHTFORGE_OPENAI_MODE: 'mock',
        INSIGHTFORGE_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let diagnostics = '';
  child.stdout?.on('data', (chunk) => { diagnostics += String(chunk); });
  child.stderr?.on('data', (chunk) => { diagnostics += String(chunk); });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited during startup.\n${diagnostics}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`);
      if (response.ok) return child;
    } catch {
      // The listener has not opened yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  throw new Error(`Production server did not start.\n${diagnostics}`);
}

async function stopProductionServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('Production server did not stop.')),
      5_000,
    )),
  ]);
}

async function responseStatusWithHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = request({
      hostname: '127.0.0.1',
      port,
      path: '/api/bootstrap',
      headers: { host },
    }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}

test('production start preserves loopback-only durable data across restart', async () => {
  test.setTimeout(30_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-production-'));
  const port = await availablePort();
  let server: ChildProcess | null = null;
  try {
    server = await startProductionServer(dataDirectory, port);
    const shell = await fetch(`http://127.0.0.1:${port}/`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('InsightForge');
    expect(await responseStatusWithHost(port, `insightforge.example:${port}`)).toBe(403);

    const created = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Production persistence',
        insightSource: 'A production restart must preserve local work.',
      }),
    });
    expect(created.status).toBe(201);
    const project = await created.json() as { id: string };

    await stopProductionServer(server);
    server = await startProductionServer(dataDirectory, port);
    const reopened = await fetch(`http://127.0.0.1:${port}/api/projects/${project.id}`);
    expect(reopened.status).toBe(200);
    await expect(reopened.json()).resolves.toMatchObject({
      id: project.id,
      name: 'Production persistence',
      insightSource: 'A production restart must preserve local work.',
    });
  } finally {
    if (server) await stopProductionServer(server).catch(() => undefined);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
