import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  WorkflowGenerationError,
  WorkflowProjectNotFoundError,
  WorkflowValidationError,
  type WorkflowService,
} from './workflow-service.js';

interface ProjectParameters {
  id: string;
}

export interface WorkflowRouteOptions {
  beforeGeneration?: () => Promise<void>;
}

function handleWorkflowError(error: unknown, reply: FastifyReply) {
  if (error instanceof WorkflowProjectNotFoundError) {
    return reply.status(404).send({
      code: 'project_not_found',
      error: 'Project not found',
    });
  }
  if (error instanceof WorkflowValidationError) {
    return reply.status(400).send({ code: 'invalid_input', error: error.message });
  }
  if (error instanceof WorkflowGenerationError) {
    const unavailable = error.code === 'api_key_missing'
      || error.code === 'openai_unavailable';
    return reply.status(unavailable ? 503 : 502).send({
      code: error.code,
      error: error.message,
    });
  }
  throw error;
}

export function registerWorkflowRoutes(
  app: FastifyInstance,
  workflows: WorkflowService,
  options: WorkflowRouteOptions = {},
): void {
  app.get<{ Params: ProjectParameters }>(
    '/api/projects/:id/workflow',
    async (request, reply) => {
      try {
        return workflows.getProjectWorkflow(request.params.id);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/projects/:id/design-brief-runs',
    async (request, reply) => {
      try {
        await options.beforeGeneration?.();
        const workflow = await workflows.generateDesignBrief(request.params.id);
        return reply.status(201).send(workflow);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.get<{ Params: ProjectParameters }>(
    '/api/projects/:id/concept-screen-runs/events',
    (request, reply) => {
      try {
        workflows.getProjectWorkflow(request.params.id);
        reply.hijack();
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        });
        reply.raw.write(': connected\n\n');
        const unsubscribe = workflows.subscribeConceptScreenProgress(
          request.params.id,
          (event) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`),
        );
        request.raw.once('close', unsubscribe);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/projects/:id/concept-screen-runs',
    async (request, reply) => {
      try {
        await options.beforeGeneration?.();
        const workflow = await workflows.generateConceptScreens(request.params.id);
        return reply.status(201).send(workflow);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/projects/:id/prd-runs',
    async (request, reply) => {
      try {
        await options.beforeGeneration?.();
        const workflow = await workflows.generatePrd(request.params.id);
        return reply.status(201).send(workflow);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.delete<{ Params: ProjectParameters }>(
    '/api/projects/:id/concept-screen-runs/active',
    async (request, reply) => {
      try {
        const cancelled = workflows.cancelConceptScreens(request.params.id);
        return cancelled
          ? reply.status(202).send({ state: 'cancelling' })
          : reply.status(409).send({
              code: 'no_active_generation',
              error: 'No Concept Screen generation is active.',
            });
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.get<{ Params: ProjectParameters }>(
    '/api/projects/:id/deliverables',
    async (request, reply) => {
      try {
        const exported = workflows.exportDeliverables(request.params.id);
        return reply
          .type('application/zip')
          .header(
            'content-disposition',
            `attachment; filename="${exported.fileName}"`,
          )
          .send(exported.bytes);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.get<{ Params: ProjectParameters & { assetId: string } }>(
    '/api/projects/:id/concept-screen-assets/:assetId',
    async (request, reply) => {
      try {
        const bytes = workflows.getConceptScreenAsset(
          request.params.id,
          request.params.assetId,
        );
        return reply.type('image/png').send(bytes);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );
}
