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
}
