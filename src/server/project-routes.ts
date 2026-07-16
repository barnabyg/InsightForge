import type { FastifyInstance, FastifyReply } from 'fastify';
import type { CreateProjectInput } from '../shared/projects.js';
import {
  ProjectInsightLockedError,
  ProjectNotFoundError,
  type ProjectService,
} from './project-service.js';

interface ProjectParameters {
  id: string;
}

interface ProjectPatch {
  name?: unknown;
  insightSource?: unknown;
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: message });
}

function handleProjectError(error: unknown, reply: FastifyReply) {
  if (error instanceof ProjectNotFoundError) {
    return reply.status(404).send({ error: 'Project not found' });
  }
  if (error instanceof ProjectInsightLockedError) {
    return reply.status(409).send({ error: error.message });
  }
  if (error instanceof TypeError) {
    return badRequest(reply, error.message);
  }
  throw error;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  projects: ProjectService,
): void {
  app.get('/api/projects', async () => projects.listProjects());

  app.post('/api/projects', async (request, reply) => {
    const input = (request.body ?? {}) as CreateProjectInput;
    if (input.name !== undefined && typeof input.name !== 'string') {
      return badRequest(reply, 'Project name must be text');
    }
    if (
      input.insightSource !== undefined
      && typeof input.insightSource !== 'string'
    ) {
      return badRequest(reply, 'Insight Source must be text');
    }

    const project = projects.createProject(input);
    return reply.status(201).send(project);
  });

  app.get<{ Params: ProjectParameters }>(
    '/api/projects/:id',
    async (request, reply) => {
      const project = projects.getProject(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: 'Project not found' });
      }
      return project;
    },
  );

  app.patch<{ Params: ProjectParameters }>(
    '/api/projects/:id',
    async (request, reply) => {
      const patch = (request.body ?? {}) as ProjectPatch;
      const fields = ['name', 'insightSource'].filter((field) =>
        Object.hasOwn(patch, field),
      );
      if (fields.length !== 1) {
        return badRequest(
          reply,
          'Update exactly one of Project name or Insight Source',
        );
      }

      try {
        if (fields[0] === 'name') {
          if (typeof patch.name !== 'string') {
            return badRequest(reply, 'Project name must be text');
          }
          return projects.renameProject(request.params.id, patch.name);
        }
        if (typeof patch.insightSource !== 'string') {
          return badRequest(reply, 'Insight Source must be text');
        }
        return projects.updateInsightSource(
          request.params.id,
          patch.insightSource,
        );
      } catch (error) {
        return handleProjectError(error, reply);
      }
    },
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/projects/:id/duplicate',
    async (request, reply) => {
      try {
        return reply
          .status(201)
          .send(projects.duplicateProject(request.params.id));
      } catch (error) {
        return handleProjectError(error, reply);
      }
    },
  );

  app.delete<{ Params: ProjectParameters }>(
    '/api/projects/:id',
    async (request, reply) => {
      try {
        projects.deleteProject(request.params.id);
        return reply.status(204).send();
      } catch (error) {
        return handleProjectError(error, reply);
      }
    },
  );
}
