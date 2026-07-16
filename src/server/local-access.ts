import type { FastifyInstance } from 'fastify';

function isLocalHost(host: string | undefined): boolean {
  if (!host) {
    return false;
  }

  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)
    || /^\[::1\](?::\d+)?$/i.test(host);
}
function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.protocol === 'http:'
      && (url.hostname === 'localhost'
        || url.hostname === '127.0.0.1'
        || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

export function registerLocalAccess(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!isLocalHost(request.headers.host) || !isLocalOrigin(request.headers.origin)) {
      await reply.code(403).send({
        error: {
          code: 'local_access_only',
          message: 'InsightForge accepts requests only from this computer',
        },
      });
    }
  });
}
