import { createWriteStream, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WorkflowRerunRequest } from '../shared/generation.js';
import {
  cleanupProjectImportDirectory,
  ProjectImportError,
} from './project-import.js';
import {
  WorkflowGenerationError,
  WorkflowProjectNotFoundError,
  WorkflowValidationError,
  type WorkflowService,
} from './workflow-service.js';
import { StorageCapacityError, StorageInitializationError } from './storage.js';

interface ProjectParameters {
  id: string;
}

interface WorkflowSnapshotParameters extends ProjectParameters {
  snapshotId: string;
}

interface InsightRevisionPatch {
  insightSource?: unknown;
}

export interface WorkflowRouteOptions {
  beforeGeneration?: () => Promise<void>;
}

interface ProjectImportUpload {
  archivePath: string;
  directory: string;
}

function handleWorkflowError(error: unknown, reply: FastifyReply) {
  if (error instanceof StorageCapacityError) {
    return reply.status(507).send({ code: error.code, error: error.message });
  }
  if (error instanceof StorageInitializationError) {
    return reply.status(507).send({ code: error.code, error: error.message });
  }
  if (error instanceof ProjectImportError) {
    return reply.status(400).send({ code: error.code, error: error.message });
  }
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
  app.addContentTypeParser(
    'application/zip',
    { bodyLimit: Number.MAX_SAFE_INTEGER },
    (_request, stream, done) => {
      let directory: string;
      try {
        directory = mkdtempSync(join(tmpdir(), 'insightforge-project-import-'));
      } catch (error) {
        done(null, new ProjectImportError(
          'project_import_archive_invalid',
          `The selected Project Export could not be staged. ${
            error instanceof Error ? error.message : ''
          }`.trim(),
        ));
        return;
      }
      const archivePath = join(directory, 'project-export.zip');
      const output = createWriteStream(archivePath, { flags: 'wx' });
      let settled = false;
      const fail = (error?: unknown) => {
        if (settled) return;
        settled = true;
        const cleanup = () => cleanupProjectImportDirectory(directory);
        if (output.closed) cleanup();
        else output.once('close', cleanup);
        output.destroy();
        done(null, new ProjectImportError(
          'project_import_archive_invalid',
          `The selected Project Export could not be staged. ${
            error instanceof Error ? error.message : ''
          }`.trim(),
        ));
      };
      output.once('error', fail);
      output.once('close', () => {
        if (settled) return;
        settled = true;
        done(null, { archivePath, directory } satisfies ProjectImportUpload);
      });
      stream.once('error', fail);
      stream.once('aborted', fail);
      stream.pipe(output);
    },
  );

  app.post<{ Body: ProjectImportUpload | ProjectImportError }>(
    '/api/project-imports',
    async (request, reply) => {
      try {
        if (request.body instanceof ProjectImportError) throw request.body;
        try {
          return reply.status(201).send(
            workflows.importProjectFile(request.body.archivePath),
          );
        } finally {
          cleanupProjectImportDirectory(request.body.directory);
        }
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

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
    '/api/projects/:id/full-generations/events',
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
        const unsubscribe = workflows.subscribeFullGenerationProgress(
          request.params.id,
          (event) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`),
        );
        request.raw.once('close', unsubscribe);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.get<{ Params: WorkflowSnapshotParameters }>(
    '/api/projects/:id/workflow-snapshots/:snapshotId',
    async (request, reply) => {
      try {
        return workflows.getWorkflowSnapshot(
          request.params.id,
          request.params.snapshotId,
        );
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.post<{ Params: WorkflowSnapshotParameters }>(
    '/api/projects/:id/workflow-snapshots/:snapshotId/restoration',
    async (request, reply) => {
      try {
        return workflows.restoreWorkflowSnapshot(
          request.params.id,
          request.params.snapshotId,
        );
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.delete<{ Params: WorkflowSnapshotParameters }>(
    '/api/projects/:id/workflow-snapshots/:snapshotId',
    async (request, reply) => {
      try {
        return await workflows.deleteWorkflowSnapshot(
          request.params.id,
          request.params.snapshotId,
        );
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/projects/:id/full-generations',
    async (request, reply) => {
      try {
        await options.beforeGeneration?.();
        const workflow = await workflows.generateFullWorkflow(request.params.id);
        return reply.status(201).send(workflow);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/projects/:id/insight-revisions',
    async (request, reply) => {
      try {
        return reply.status(201).send(
          workflows.beginInsightRevision(request.params.id),
        );
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.patch<{ Params: ProjectParameters; Body: InsightRevisionPatch }>(
    '/api/projects/:id/insight-revisions/active',
    async (request, reply) => {
      if (typeof request.body?.insightSource !== 'string') {
        return reply.status(400).send({
          code: 'invalid_input',
          error: 'Insight Revision must be text.',
        });
      }
      try {
        return workflows.updateInsightRevision(
          request.params.id,
          request.body.insightSource,
        );
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/projects/:id/insight-revisions/active/generation',
    async (request, reply) => {
      try {
        await options.beforeGeneration?.();
        return reply.status(201).send(
          await workflows.generateCandidateFromInsightRevision(request.params.id),
        );
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.delete<{ Params: ProjectParameters }>(
    '/api/projects/:id/insight-revisions/active',
    async (request, reply) => {
      try {
        return workflows.discardInsightRevision(request.params.id);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.post<{ Params: ProjectParameters; Body: WorkflowRerunRequest }>(
    '/api/projects/:id/workflow-reruns',
    async (request, reply) => {
      try {
        await options.beforeGeneration?.();
        const workflow = await workflows.regenerateWorkflow(
          request.params.id,
          request.body?.stageId,
        );
        return reply.status(201).send(workflow);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/projects/:id/full-generations/resume',
    async (request, reply) => {
      try {
        await options.beforeGeneration?.();
        return await workflows.resumeFullWorkflow(request.params.id);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/projects/:id/full-generations/promotion',
    async (request, reply) => {
      try {
        return workflows.promoteFullWorkflow(request.params.id);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.post<{ Params: ProjectParameters }>(
    '/api/projects/:id/full-generations/warning-review/keep',
    async (request, reply) => {
      try {
        return workflows.keepCandidateAfterWarningReview(request.params.id);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.delete<{ Params: ProjectParameters }>(
    '/api/projects/:id/full-generations/active',
    async (request, reply) => {
      try {
        const cancelled = workflows.cancelFullWorkflow(request.params.id);
        return cancelled
          ? reply.status(202).send({ state: 'cancelling' })
          : reply.status(409).send({
              code: 'no_active_generation',
              error: 'No Full Generation is active.',
            });
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.delete<{ Params: ProjectParameters }>(
    '/api/projects/:id/full-generations/candidate',
    async (request, reply) => {
      try {
        return await workflows.discardFullWorkflow(request.params.id);
      } catch (error) {
        return handleWorkflowError(error, reply);
      }
    },
  );

  app.get<{ Params: ProjectParameters }>(
    '/api/projects/:id/export',
    async (request, reply) => {
      try {
        const exported = workflows.exportProject(request.params.id);
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
