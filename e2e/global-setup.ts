import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildApp } from '../src/server/app.js';

export default async function globalSetup() {
  const dataDirectory = resolve('.data/playwright');
  await rm(dataDirectory, { recursive: true, force: true });
  await mkdir(dataDirectory, { recursive: true });

  process.env.INSIGHTFORGE_OPENAI_MODE = 'mock';
  const app = await buildApp({ dataDirectory });
  await app.listen({ host: '127.0.0.1', port: 4317 });

  return async () => {
    await app.close();
  };
}
