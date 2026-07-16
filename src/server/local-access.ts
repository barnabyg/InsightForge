import type { FastifyInstance } from 'fastify';

const loopbackHostnames = new Set(['localhost', '127.0.0.1', '::1']);

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return loopbackHostnames.has(normalized);
}

function isLocalHost(host: string | undefined): boolean {
  if (!host) {
    return false;
  }

  try {
    const url = new URL(`http://${host}`);
    return url.username === ''
      && url.password === ''
      && url.pathname === '/'
      && url.search === ''
      && url.hash === ''
      && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}
function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && isLoopbackHostname(url.hostname);
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
