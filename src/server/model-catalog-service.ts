import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ApplicationMode } from '../shared/bootstrap.js';
import type { ModelCatalog } from '../shared/workflow-configuration.js';
import {
  discoverCompatibleModels,
  isCompatibleMultimodalTextModel,
  type CompatibleModels,
} from './model-discovery.js';
import { initializeStorage } from './storage.js';
import { defaultStageConfigurations } from './workflow-defaults.js';

interface CacheRow {
  payload: string;
  checked_at: string;
}

export interface ModelCatalogServiceOptions {
  mode: ApplicationMode;
  apiKey?: string;
  now?: () => Date;
  discoverModels?: () => Promise<CompatibleModels>;
}

export interface ModelCatalogService {
  getModelCatalog(): Promise<ModelCatalog>;
  close(): void;
}

function defaultModels(): CompatibleModels {
  const text = [...new Set(
    defaultStageConfigurations
      .filter(({ kind }) => kind === 'text')
      .map(({ model }) => model),
  )];
  return {
    text,
    multimodalText: text.filter(isCompatibleMultimodalTextModel),
    image: [...new Set(
      defaultStageConfigurations
        .filter(({ kind }) => kind === 'image')
        .map(({ model }) => model),
    )],
  };
}

function parseCache(row: CacheRow | undefined): ModelCatalog | null {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload) as CompatibleModels;
    if (
      !Array.isArray(parsed.text)
      || !parsed.text.every((id) => typeof id === 'string')
      || !Array.isArray(parsed.multimodalText)
      || !parsed.multimodalText.every((id) => typeof id === 'string')
      || !Array.isArray(parsed.image)
      || !parsed.image.every((id) => typeof id === 'string')
    ) {
      return null;
    }
    return {
      ...parsed,
      source: 'cache',
      checkedAt: row.checked_at,
    };
  } catch {
    return null;
  }
}

export async function openModelCatalogService(
  dataDirectory: string,
  options: ModelCatalogServiceOptions,
): Promise<ModelCatalogService> {
  await initializeStorage(dataDirectory);
  const database = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
  const now = options.now ?? (() => new Date());

  function fallback(): ModelCatalog {
    const cached = parseCache(database.prepare(`
      SELECT payload, checked_at
      FROM model_discovery_cache
      WHERE cache_key = 'compatible_models'
    `).get() as unknown as CacheRow | undefined);
    return cached ?? {
      ...defaultModels(),
      source: options.mode === 'mock' ? 'mock' : 'defaults',
      checkedAt: now().toISOString(),
    };
  }

  return {
    async getModelCatalog() {
      if (options.mode === 'mock') {
        return {
          ...defaultModels(),
          source: 'mock',
          checkedAt: now().toISOString(),
        };
      }
      if (!options.apiKey) {
        return fallback();
      }

      try {
        const catalog = await (
          options.discoverModels
          ?? (() => discoverCompatibleModels(options.apiKey!))
        )();
        if (catalog.text.length === 0 || catalog.image.length === 0) {
          throw new Error('No compatible OpenAI models were returned');
        }
        const checkedAt = now().toISOString();
        database.prepare(`
          INSERT INTO model_discovery_cache (cache_key, payload, checked_at)
          VALUES ('compatible_models', ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET
            payload = excluded.payload,
            checked_at = excluded.checked_at
        `).run(JSON.stringify(catalog), checkedAt);
        return { ...catalog, source: 'live', checkedAt };
      } catch {
        return fallback();
      }
    },

    close() {
      database.close();
    },
  };
}
