import { mkdir } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaultStageConfigurations } from './workflow-defaults.js';

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
      VALUES ('schema_version', '2')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        insight_source TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        name_is_automatic INTEGER NOT NULL DEFAULT 1
          CHECK (name_is_automatic IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS stage_configurations (
        stage_id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        image_quality TEXT
          CHECK (image_quality IS NULL OR image_quality IN ('low', 'medium', 'high')),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prompt_drafts (
        stage_id TEXT PRIMARY KEY
          REFERENCES stage_configurations(stage_id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_discovery_cache (
        cache_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        checked_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stage_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL
          REFERENCES projects(id) ON DELETE CASCADE,
        stage_id TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('running', 'succeeded', 'failed')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        prompt_snapshot TEXT NOT NULL,
        model_snapshot TEXT NOT NULL,
        stage_configuration_updated_at TEXT NOT NULL,
        input_snapshot TEXT NOT NULL,
        input_artifact_id TEXT,
        input_run_id TEXT,
        input_lineage_json TEXT,
        assembled_request TEXT NOT NULL,
        settings_json TEXT,
        attempt_history_json TEXT,
        response_id TEXT,
        request_id TEXT,
        usage_json TEXT,
        validation_json TEXT,
        error_code TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL
          REFERENCES projects(id) ON DELETE CASCADE,
        stage_id TEXT NOT NULL,
        run_id TEXT NOT NULL
          REFERENCES stage_runs(id) ON DELETE CASCADE,
        markdown TEXT NOT NULL,
        created_at TEXT NOT NULL,
        validation_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS current_artifacts (
        project_id TEXT NOT NULL
          REFERENCES projects(id) ON DELETE CASCADE,
        stage_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL UNIQUE
          REFERENCES artifacts(id) ON DELETE CASCADE,
        PRIMARY KEY (project_id, stage_id)
      );

      CREATE TABLE IF NOT EXISTS pending_cascades (
        project_id TEXT PRIMARY KEY
          REFERENCES projects(id) ON DELETE CASCADE,
        design_brief_artifact_id TEXT NOT NULL
          REFERENCES artifacts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS binary_assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL
          REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL
          REFERENCES stage_runs(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL UNIQUE,
        media_type TEXT NOT NULL CHECK (media_type = 'image/png'),
        byte_size INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS concept_screen_operations (
        run_id TEXT NOT NULL
          REFERENCES stage_runs(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 3),
        status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        asset_id TEXT REFERENCES binary_assets(id) ON DELETE SET NULL,
        response_id TEXT,
        request_id TEXT,
        usage_json TEXT,
        error_code TEXT,
        error_message TEXT,
        PRIMARY KEY (run_id, ordinal)
      );
    `);

    const stageRunColumns = database.prepare('PRAGMA table_info(stage_runs)')
      .all() as unknown as Array<{ name: string }>;
    if (!stageRunColumns.some(({ name }) => name === 'settings_json')) {
      database.exec('ALTER TABLE stage_runs ADD COLUMN settings_json TEXT;');
    }
    if (!stageRunColumns.some(({ name }) => name === 'input_artifact_id')) {
      database.exec('ALTER TABLE stage_runs ADD COLUMN input_artifact_id TEXT;');
    }
    if (!stageRunColumns.some(({ name }) => name === 'input_run_id')) {
      database.exec('ALTER TABLE stage_runs ADD COLUMN input_run_id TEXT;');
    }
    if (!stageRunColumns.some(({ name }) => name === 'attempt_history_json')) {
      database.exec('ALTER TABLE stage_runs ADD COLUMN attempt_history_json TEXT;');
    }
    if (!stageRunColumns.some(({ name }) => name === 'input_lineage_json')) {
      database.exec('ALTER TABLE stage_runs ADD COLUMN input_lineage_json TEXT;');
    }

    const insertDefault = database.prepare(`
      INSERT INTO stage_configurations (
        stage_id, prompt, model, image_quality, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(stage_id) DO NOTHING
    `);
    for (const stage of defaultStageConfigurations) {
      insertDefault.run(
        stage.id,
        stage.prompt,
        stage.model,
        stage.imageQuality,
        '1970-01-01T00:00:00.000Z',
      );
    }
  } finally {
    database.close();
  }

  return { state: 'ready' };
}
