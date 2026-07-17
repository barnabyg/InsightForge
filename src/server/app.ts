import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CompletedConnectivityState } from './connectivity.js';
import type { CompatibleModels } from './model-discovery.js';
import type { TextGenerationBoundary } from '../shared/generation.js';
import type { ImageGenerationBoundary } from './image-generation-boundary.js';
import { registerBootstrapRoutes } from './bootstrap-routes.js';
import { createConnectivityMonitor } from './connectivity-monitor.js';
import { registerLocalAccess } from './local-access.js';
import { openModelCatalogService } from './model-catalog-service.js';
import { createMockTextGeneration } from './mock-text-generation.js';
import { createMockImageGeneration } from './mock-image-generation.js';
import { createOpenAIImageGeneration } from './openai-image-generation.js';
import { createOpenAITextGeneration } from './openai-text-generation.js';
import { GenerationBoundaryError } from './generation-boundary.js';
import { openProjectService } from './project-service.js';
import { registerProjectRoutes } from './project-routes.js';
import { defaultDataDirectory } from './storage.js';
import { registerWebShell } from './web-shell.js';
import { openWorkflowConfigurationService } from './workflow-configuration-service.js';
import { registerWorkflowConfigurationRoutes } from './workflow-configuration-routes.js';
import {
  openWorkflowService,
  WorkflowGenerationError,
} from './workflow-service.js';
import { registerWorkflowRoutes } from './workflow-routes.js';
import type { ApplicationMode } from '../shared/bootstrap.js';

export interface BuildAppOptions {
  dataDirectory?: string;
  generateImportId?: () => string;
  mode?: ApplicationMode;
  apiKey?: string;
  now?: () => Date;
  checkOpenAI?: () => Promise<CompletedConnectivityState>;
  discoverModels?: () => Promise<CompatibleModels>;
  textGeneration?: TextGenerationBoundary;
  imageGeneration?: ImageGenerationBoundary;
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
  const textGeneration = options.textGeneration
    ?? (mode === 'mock'
      ? createMockTextGeneration({ delayMs: 350 })
      : apiKey
        ? createOpenAITextGeneration(apiKey)
        : {
            async generateDesignBrief() {
              throw new GenerationBoundaryError(
                'api_key_missing',
                'Set OPENAI_API_KEY to enable generation.',
              );
            },
            async generatePrd() {
              throw new GenerationBoundaryError(
                'api_key_missing',
                'Set OPENAI_API_KEY to enable generation.',
              );
            },
          });
  const workflowService = await openWorkflowService(dataDirectory, {
    generateImportId: options.generateImportId,
    now,
    textGeneration,
    imageGeneration: options.imageGeneration
      ?? (mode === 'mock'
        ? createMockImageGeneration({ delayMs: 250 })
        : apiKey
          ? createOpenAIImageGeneration(apiKey)
          : {
              async generateConceptScreen() {
                throw new GenerationBoundaryError(
                  'api_key_missing',
                  'Set OPENAI_API_KEY to enable generation.',
                );
              },
            }),
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
    workflowService.close();
  });

  registerLocalAccess(app);
  registerBootstrapRoutes(app, { mode, storage, connectivity });
  registerProjectRoutes(app, projectService);
  registerWorkflowConfigurationRoutes(
    app,
    workflowConfiguration,
    modelCatalog,
  );
  registerWorkflowRoutes(app, workflowService, {
    beforeGeneration: async () => {
      const state = await connectivity.refresh();
      if (state.state !== 'connected') {
        throw new WorkflowGenerationError(
          state.state === 'api_key_missing'
            ? 'api_key_missing'
            : 'openai_unavailable',
          state.message,
        );
      }
    },
  });

  const webRoot = options.webRoot ?? join(process.cwd(), 'dist');
  if (await isDirectory(webRoot)) {
    registerWebShell(app, webRoot);
  }

  return app;
}
