import { buildApp } from './app.js';

const host = '127.0.0.1';
const port = Number.parseInt(process.env.INSIGHTFORGE_PORT ?? '4317', 10);
const app = await buildApp({ logger: true });

const stop = async () => {
  await app.close();
  process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
