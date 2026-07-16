import Fastify, { type FastifyInstance } from 'fastify';
import {
  checkConnectivity,
  type ApplicationMode,
  type ConnectivityState,
} from './connectivity.js';
import { defaultDataDirectory, initializeStorage } from './storage.js';

export interface BuildAppOptions {
  dataDirectory?: string;
  mode?: ApplicationMode;
  apiKey?: string;
  now?: () => Date;
  checkOpenAI?: () => Promise<ConnectivityState>;
  logger?: boolean;
}

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
  const storage = await initializeStorage(
    options.dataDirectory ?? defaultDataDirectory(),
  );
  const connectivity = options.checkOpenAI
    ? await options.checkOpenAI()
    : await checkConnectivity({
        mode,
        apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
        now,
      });

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

  app.get('/api/bootstrap', async () => ({
    app: { name: 'InsightForge', version: '0.1.0' },
    mode,
    connectivity,
    storage,
  }));

  return app;
}
