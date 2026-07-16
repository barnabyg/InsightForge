import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openModelCatalogService,
  type ModelCatalogService,
} from './model-catalog-service.js';

describe('Model Catalog service', () => {
  const temporaryDirectories: string[] = [];
  const services: ModelCatalogService[] = [];

  async function temporaryDirectory() {
    const directory = await mkdtemp(join(tmpdir(), 'insightforge-models-'));
    temporaryDirectories.push(directory);
    return directory;
  }

  afterEach(async () => {
    services.splice(0).forEach((service) => service.close());
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('uses the last live compatible catalog, then bundled defaults when no cache exists', async () => {
    const dataDirectory = await temporaryDirectory();
    const live = await openModelCatalogService(dataDirectory, {
      mode: 'live',
      apiKey: 'test-key',
      now: () => new Date('2026-07-16T15:30:00.000Z'),
      discoverModels: async () => ({
        text: ['gpt-5.4-mini', 'gpt-5.6-luna'],
        image: ['gpt-image-2'],
      }),
    });
    services.push(live);
    expect(await live.getModelCatalog()).toEqual({
      text: ['gpt-5.4-mini', 'gpt-5.6-luna'],
      image: ['gpt-image-2'],
      source: 'live',
      checkedAt: '2026-07-16T15:30:00.000Z',
    });

    live.close();
    services.splice(services.indexOf(live), 1);
    const cached = await openModelCatalogService(dataDirectory, {
      mode: 'live',
      apiKey: 'test-key',
      now: () => new Date('2026-07-16T15:31:00.000Z'),
      discoverModels: async () => { throw new Error('OpenAI unavailable'); },
    });
    services.push(cached);
    expect(await cached.getModelCatalog()).toEqual({
      text: ['gpt-5.4-mini', 'gpt-5.6-luna'],
      image: ['gpt-image-2'],
      source: 'cache',
      checkedAt: '2026-07-16T15:30:00.000Z',
    });

    const mock = await openModelCatalogService(dataDirectory, {
      mode: 'mock',
      now: () => new Date('2026-07-16T15:32:00.000Z'),
      discoverModels: async () => { throw new Error('must not be called'); },
    });
    services.push(mock);
    expect(await mock.getModelCatalog()).toEqual({
      text: ['gpt-5.6-luna'],
      image: ['gpt-image-2'],
      source: 'mock',
      checkedAt: '2026-07-16T15:32:00.000Z',
    });

    const emptyDirectory = await temporaryDirectory();
    const defaults = await openModelCatalogService(emptyDirectory, {
      mode: 'live',
      apiKey: 'test-key',
      now: () => new Date('2026-07-16T15:31:00.000Z'),
      discoverModels: async () => { throw new Error('OpenAI unavailable'); },
    });
    services.push(defaults);
    expect(await defaults.getModelCatalog()).toEqual({
      text: ['gpt-5.6-luna'],
      image: ['gpt-image-2'],
      source: 'defaults',
      checkedAt: '2026-07-16T15:31:00.000Z',
    });
  });
});
