import { mkdir } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface StorageState {
  state: 'ready';
}
export function defaultDataDirectory(environment = process.env): string {
  if (environment.INSIGHTFORGE_DATA_DIR) {
    return environment.INSIGHTFORGE_DATA_DIR;
  }

  if (platform() === 'win32') {
    return join(
      environment.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'InsightForge',
    );
  }

  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'InsightForge');
  }

  return join(
    environment.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'insightforge',
  );
}

export async function initializeStorage(
  dataDirectory: string,
): Promise<StorageState> {
  await mkdir(join(dataDirectory, 'assets'), { recursive: true });

  const database = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO app_metadata (key, value)
      VALUES ('schema_version', '1')
      ON CONFLICT(key) DO NOTHING;

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        insight_source TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        name_is_automatic INTEGER NOT NULL DEFAULT 1
          CHECK (name_is_automatic IN (0, 1))
      );
    `);
  } finally {
    database.close();
  }

  return { state: 'ready' };
}
