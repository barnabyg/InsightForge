import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  CommitStageConfigurationInput,
  StageId,
} from '../shared/workflow-configuration.js';
import type { ModelCatalogService } from './model-catalog-service.js';
import {
  WorkflowConfigurationValidationError,
  type WorkflowConfigurationService,
} from './workflow-configuration-service.js';

interface StageParameters {
  stageId: string;
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: message });
}

function stageId(value: string): StageId | null {
  return value === 'design_brief'
    || value === 'concept_screens'
    || value === 'prd'
    ? value
    : null;
}

function handleConfigurationError(error: unknown, reply: FastifyReply) {
  if (error instanceof WorkflowConfigurationValidationError) {
    return badRequest(reply, error.message);
  }
  throw error;
}

export function registerWorkflowConfigurationRoutes(
  app: FastifyInstance,
  configuration: WorkflowConfigurationService,
  models: ModelCatalogService,
): void {
  app.get('/api/workflow-configuration', async () =>
    configuration.getWorkflowConfiguration());

  app.put<{ Params: StageParameters }>(
    '/api/workflow-configuration/stages/:stageId/draft',
    async (request, reply) => {
      const id = stageId(request.params.stageId);
      const body = request.body as { prompt?: unknown } | null;
      if (!id) return badRequest(reply, 'Unknown workflow stage');
      if (!body || typeof body.prompt !== 'string') {
        return badRequest(reply, 'Prompt Draft must be text');
      }
      configuration.savePromptDraft(id, body.prompt);
      return configuration.getWorkflowConfiguration();
    },
  );

  app.delete<{ Params: StageParameters }>(
    '/api/workflow-configuration/stages/:stageId/draft',
    async (request, reply) => {
      const id = stageId(request.params.stageId);
      if (!id) return badRequest(reply, 'Unknown workflow stage');
      configuration.discardPromptDraft(id);
      return configuration.getWorkflowConfiguration();
    },
  );

  app.post<{ Params: StageParameters }>(
    '/api/workflow-configuration/stages/:stageId/save',
    async (request, reply) => {
      const id = stageId(request.params.stageId);
      if (!id) return badRequest(reply, 'Unknown workflow stage');
      const body = request.body as Partial<CommitStageConfigurationInput> | null;
      if (
        !body
        || typeof body.prompt !== 'string'
        || typeof body.model !== 'string'
        || (
          body.imageQuality !== null
          && body.imageQuality !== 'low'
          && body.imageQuality !== 'medium'
          && body.imageQuality !== 'high'
        )
      ) {
        return badRequest(reply, 'Invalid Stage Configuration');
      }
      try {
        configuration.commitStageConfiguration(id, {
          prompt: body.prompt,
          model: body.model,
          imageQuality: body.imageQuality,
        });
        return configuration.getWorkflowConfiguration();
      } catch (error) {
        return handleConfigurationError(error, reply);
      }
    },
  );

  app.post<{ Params: StageParameters }>(
    '/api/workflow-configuration/stages/:stageId/reset',
    async (request, reply) => {
      const id = stageId(request.params.stageId);
      if (!id) return badRequest(reply, 'Unknown workflow stage');
      configuration.resetStageConfiguration(id);
      return configuration.getWorkflowConfiguration();
    },
  );

  app.post('/api/workflow-configuration/reset', async () => {
    configuration.resetWorkflowConfiguration();
    return configuration.getWorkflowConfiguration();
  });

  app.get('/api/workflow-configuration/export', async (_request, reply) => {
    reply.header(
      'content-disposition',
      'attachment; filename="insightforge-workflow-configuration.json"',
    );
    return configuration.exportWorkflowConfiguration();
  });

  app.post('/api/workflow-configuration/import', async (request, reply) => {
    try {
      configuration.importWorkflowConfiguration(request.body);
      return configuration.getWorkflowConfiguration();
    } catch (error) {
      return handleConfigurationError(error, reply);
    }
  });

  app.get('/api/models', async () => models.getModelCatalog());
}
