import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

const assetTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function notFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: { code: 'not_found', message: 'File not found' },
  });
}

export function registerWebShell(app: FastifyInstance, webRoot: string): void {
  app.get('/', async (_request, reply) => {
    const index = await readFile(join(webRoot, 'index.html'));
    return reply.type('text/html; charset=utf-8').send(index);
  });

  app.get<{ Params: { file: string } }>('/assets/:file', async (request, reply) => {
    const { file } = request.params;
    if (!/^[a-zA-Z0-9_.-]+$/.test(file)) {
      return notFound(reply);
    }

    try {
      const asset = await readFile(join(webRoot, 'assets', file));
      const contentType = assetTypes[extname(file).toLowerCase()]
        ?? 'application/octet-stream';
      return reply.type(contentType).send(asset);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return notFound(reply);
      }
      throw error;
    }
  });
}
