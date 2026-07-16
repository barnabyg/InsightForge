import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CompletedConnectivityState } from './connectivity.js';
import type { CompatibleModels } from './model-discovery.js';
import { registerBootstrapRoutes } from './bootstrap-routes.js';
import { createConnectivityMonitor } from './connectivity-monitor.js';
import { registerLocalAccess } from './local-access.js';
import { openModelCatalogService } from './model-catalog-service.js';
import { openProjectService } from './project-service.js';
import { registerProjectRoutes } from './project-routes.js';
import { defaultDataDirectory } from './storage.js';
import { registerWebShell } from './web-shell.js';
import { openWorkflowConfigurationService } from './workflow-configuration-service.js';
import { registerWorkflowConfigurationRoutes } from './workflow-configuration-routes.js';
import type { ApplicationMode } from '../shared/bootstrap.js';

export interface BuildAppOptions {
  dataDirectory?: string;
  mode?: ApplicationMode;
  apiKey?: string;
  now?: () => Date;
  checkOpenAI?: () => Promise<CompletedConnectivityState>;
  discoverModels?: () => Promise<CompatibleModels>;
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
  const dataDirectory = options.dataDirectory ?? defaultDataDirectory();
  const projectService = await openProjectService(
    dataDirectory,
    { now },
  );
  const workflowConfiguration = await openWorkflowConfigurationService(
    dataDirectory,
    { now },
  );
  const modelCatalog = await openModelCatalogService(dataDirectory, {
    mode,
    apiKey,
    now,
    discoverModels: options.discoverModels,
  });
  const storage = { state: 'ready' as const };
  const connectivity = createConnectivityMonitor(
    { mode, apiKey, now },
    options.checkOpenAI,
  );

  app.addHook('onReady', () => {
    connectivity.start();
  });
  app.addHook('onClose', () => {
    projectService.close();
    workflowConfiguration.close();
    modelCatalog.close();
  });

  registerLocalAccess(app);
  registerBootstrapRoutes(app, { mode, storage, connectivity });
  registerProjectRoutes(app, projectService);
  registerWorkflowConfigurationRoutes(
    app,
    workflowConfiguration,
    modelCatalog,
  );

  const webRoot = options.webRoot ?? join(process.cwd(), 'dist');
  if (await isDirectory(webRoot)) {
    registerWebShell(app, webRoot);
  }

  return app;
}
