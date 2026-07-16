import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CompletedConnectivityState } from './connectivity.js';
import { registerBootstrapRoutes } from './bootstrap-routes.js';
import { createConnectivityMonitor } from './connectivity-monitor.js';
import { registerLocalAccess } from './local-access.js';
import { defaultDataDirectory, initializeStorage } from './storage.js';
import { registerWebShell } from './web-shell.js';
import type { ApplicationMode } from '../shared/bootstrap.js';

export interface BuildAppOptions {
  dataDirectory?: string;
  mode?: ApplicationMode;
  apiKey?: string;
  now?: () => Date;
  checkOpenAI?: () => Promise<CompletedConnectivityState>;
  webRoot?: string;
  logger?: boolean;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
  });
  const mode = options.mode ?? (
    process.env.INSIGHTFORGE_OPENAI_MODE === 'mock' ? 'mock' : 'live'
  );
  const now = options.now ?? (() => new Date());
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const storage = await initializeStorage(
    options.dataDirectory ?? defaultDataDirectory(),
  );
  const connectivity = createConnectivityMonitor(
    { mode, apiKey, now },
    options.checkOpenAI,
  );

  app.addHook('onReady', () => {
    connectivity.start();
  });

  registerLocalAccess(app);
  registerBootstrapRoutes(app, { mode, storage, connectivity });

  const webRoot = options.webRoot ?? join(process.cwd(), 'dist');
  if (await isDirectory(webRoot)) {
    registerWebShell(app, webRoot);
  }

  return app;
}
