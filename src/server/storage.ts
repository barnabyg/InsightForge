import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rm, stat, statfs, unlink } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { StorageUsage } from '../shared/storage.js';
import { defaultStageConfigurations } from './workflow-defaults.js';

export interface StorageRecovery {
  abandonedOperations: number;
  abandonedStageRuns: number;
  abandonedCandidates: number;
  orphanAssetsRemoved: number;
}

export interface StorageState {
  state: 'ready';
  recovery: StorageRecovery;
}

export interface InitializeStorageOptions {
  now?: () => Date;
}

export class StorageInitializationError extends Error {
  readonly code = 'storage_unusable';

  constructor(dataDirectory: string, cause?: unknown) {
    super(
      `Local application data at ${dataDirectory} could not be opened safely.`,
      { cause },
    );
    this.name = 'StorageInitializationError';
  }
}

function formatCapacity(bytes: number): string {
  const units = [
    { bytes: 1024 ** 3, label: 'GiB' },
    { bytes: 1024 ** 2, label: 'MiB' },
    { bytes: 1024, label: 'KiB' },
  ];
  const unit = units.find((candidate) => bytes >= candidate.bytes);
  return unit ? `${Math.floor(bytes / unit.bytes)} ${unit.label}` : `${bytes} bytes`;
}

export class StorageCapacityError extends Error {
  readonly code = 'insufficient_storage';

  constructor(
    readonly availableBytes: number,
    readonly requiredBytes: number,
  ) {
    super(
      `Generation needs at least ${formatCapacity(requiredBytes)} of free local storage; `
      + `${formatCapacity(availableBytes)} is available.`,
    );
    this.name = 'StorageCapacityError';
  }
}

interface AssetRow {
  relative_path: string;
  byte_size: number;
}

interface ProjectUsageRow {
  project_id: string;
  name: string;
  structured_bytes: number;
  asset_bytes: number;
}

const currentSchemaVersion = 7;

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function storedAssetPath(dataDirectory: string, relativePath: string): string {
  const assetsRoot = resolve(dataDirectory, 'assets');
  const path = resolve(dataDirectory, relativePath);
  if (!path.startsWith(`${assetsRoot}${sep}`)) {
    throw new StorageInitializationError(dataDirectory);
  }
  return path;
}

async function verifyWritable(dataDirectory: string): Promise<void> {
  const probePath = join(dataDirectory, 'assets', `.write-probe-${randomUUID()}`);
  let probe: Awaited<ReturnType<typeof open>> | undefined;
  try {
    probe = await open(probePath, 'wx');
    await probe.writeFile('InsightForge storage probe');
    await probe.sync();
  } finally {
    await probe?.close().catch(() => undefined);
    await unlink(probePath).catch(() => undefined);
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
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
  options: InitializeStorageOptions = {},
): Promise<StorageState> {
  try {
    await mkdir(join(dataDirectory, 'assets'), { recursive: true });
    await verifyWritable(dataDirectory);
  } catch (error) {
    throw new StorageInitializationError(dataDirectory, error);
  }

  let database: DatabaseSync;
  try {
    database = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
  } catch (error) {
    throw new StorageInitializationError(dataDirectory, error);
  }
  const recovery: StorageRecovery = {
    abandonedOperations: 0,
    abandonedStageRuns: 0,
    abandonedCandidates: 0,
    orphanAssetsRemoved: 0,
  };
  try {
    database.exec('PRAGMA foreign_keys = ON;');
    const startupCheck = database.prepare('PRAGMA quick_check;')
      .all() as unknown as Array<{ quick_check: string }>;
    if (startupCheck.length !== 1 || startupCheck[0]?.quick_check !== 'ok') {
      throw new StorageInitializationError(dataDirectory);
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const storedSchema = database.prepare(`
      SELECT value FROM app_metadata WHERE key = 'schema_version'
    `).get() as unknown as { value: string } | undefined;
    if (storedSchema) {
      const version = Number(storedSchema.value);
      if (!Number.isInteger(version) || version < 1 || version > currentSchemaVersion) {
        throw new StorageInitializationError(dataDirectory);
      }
    }

    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
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
        run_kind TEXT NOT NULL DEFAULT 'initial'
          CHECK (run_kind IN ('initial', 'regeneration', 'variation')),
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

      CREATE TABLE IF NOT EXISTS workflow_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL
          REFERENCES projects(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        preserved_by TEXT NOT NULL DEFAULT 'promotion'
          CHECK (preserved_by IN ('promotion', 'restoration')),
        replaced_from_stage TEXT NOT NULL
          CHECK (replaced_from_stage IN ('design_brief', 'concept_screens', 'prd')),
        insight_source TEXT NOT NULL,
        design_brief_artifact_id TEXT
          REFERENCES artifacts(id) ON DELETE RESTRICT,
        concept_screen_artifact_id TEXT
          REFERENCES artifacts(id) ON DELETE RESTRICT,
        prd_artifact_id TEXT
          REFERENCES artifacts(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS pending_cascades (
        project_id TEXT PRIMARY KEY
          REFERENCES projects(id) ON DELETE CASCADE,
        design_brief_artifact_id TEXT NOT NULL
          REFERENCES artifacts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS insight_revisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE
          REFERENCES projects(id) ON DELETE CASCADE,
        insight_source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE
          REFERENCES projects(id) ON DELETE CASCADE,
        run_kind TEXT NOT NULL DEFAULT 'initial'
          CHECK (run_kind IN ('initial', 'regeneration', 'variation')),
        status TEXT NOT NULL CHECK (
          status IN (
            'running', 'paused', 'failed', 'cancelled',
            'awaiting_promotion', 'awaiting_warning_review', 'kept_after_warning_review'
          )
        ),
        current_stage TEXT NOT NULL CHECK (
          current_stage IN ('design_brief', 'concept_screens', 'prd', 'promotion')
        ),
        completed_operation_count INTEGER NOT NULL DEFAULT 0,
        start_stage TEXT NOT NULL DEFAULT 'design_brief'
          CHECK (start_stage IN ('design_brief', 'concept_screens', 'prd')),
        insight_source TEXT NOT NULL,
        insight_revision_id TEXT UNIQUE
          REFERENCES insight_revisions(id) ON DELETE RESTRICT,
        configuration_json TEXT NOT NULL,
        design_brief_run_id TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,
        design_brief_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        concept_screen_run_id TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,
        concept_screen_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        prd_run_id TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,
        prd_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        warnings_json TEXT,
        error_code TEXT,
        error_message TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
    if (!stageRunColumns.some(({ name }) => name === 'run_kind')) {
      database.exec(
        "ALTER TABLE stage_runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'initial';",
      );
    }

    const candidateColumns = database.prepare('PRAGMA table_info(workflow_candidates)')
      .all() as unknown as Array<{ name: string }>;
    if (!candidateColumns.some(({ name }) => name === 'start_stage')) {
      database.exec(
        "ALTER TABLE workflow_candidates ADD COLUMN start_stage TEXT NOT NULL DEFAULT 'design_brief';",
      );
    }
    if (!candidateColumns.some(({ name }) => name === 'run_kind')) {
      database.exec(
        "ALTER TABLE workflow_candidates ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'initial';",
      );
    }
    if (!candidateColumns.some(({ name }) => name === 'insight_revision_id')) {
      database.exec(
        'ALTER TABLE workflow_candidates ADD COLUMN insight_revision_id TEXT REFERENCES insight_revisions(id) ON DELETE RESTRICT;',
      );
    }

    const snapshotColumns = database.prepare('PRAGMA table_info(workflow_snapshots)')
      .all() as unknown as Array<{ name: string; notnull: number }>;
    if (!snapshotColumns.some(({ name }) => name === 'preserved_by')) {
      database.exec(`
        ALTER TABLE workflow_snapshots
        ADD COLUMN preserved_by TEXT NOT NULL DEFAULT 'promotion'
          CHECK (preserved_by IN ('promotion', 'restoration'));
      `);
    }
    if (!snapshotColumns.some(({ name }) => name === 'insight_source')) {
      database.exec('ALTER TABLE workflow_snapshots ADD COLUMN insight_source TEXT;');
      database.exec(`
        UPDATE workflow_snapshots
        SET insight_source = (
          SELECT run.input_snapshot
          FROM artifacts AS artifact
          JOIN stage_runs AS run ON run.id = artifact.run_id
          WHERE artifact.id = workflow_snapshots.design_brief_artifact_id
        )
        WHERE insight_source IS NULL;
      `);
    }
    if (snapshotColumns.some(({ name, notnull }) =>
      name.endsWith('_artifact_id') && notnull === 1)) {
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE workflow_snapshots_v7 (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL
            REFERENCES projects(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          preserved_by TEXT NOT NULL DEFAULT 'promotion'
            CHECK (preserved_by IN ('promotion', 'restoration')),
          replaced_from_stage TEXT NOT NULL
            CHECK (replaced_from_stage IN ('design_brief', 'concept_screens', 'prd')),
          insight_source TEXT NOT NULL,
          design_brief_artifact_id TEXT
            REFERENCES artifacts(id) ON DELETE RESTRICT,
          concept_screen_artifact_id TEXT
            REFERENCES artifacts(id) ON DELETE RESTRICT,
          prd_artifact_id TEXT
            REFERENCES artifacts(id) ON DELETE RESTRICT
        );
        INSERT INTO workflow_snapshots_v7 (
          id, project_id, created_at, preserved_by, replaced_from_stage, insight_source,
          design_brief_artifact_id, concept_screen_artifact_id, prd_artifact_id
        )
        SELECT id, project_id, created_at, preserved_by, replaced_from_stage, insight_source,
               design_brief_artifact_id, concept_screen_artifact_id, prd_artifact_id
        FROM workflow_snapshots;
        DROP TABLE workflow_snapshots;
        ALTER TABLE workflow_snapshots_v7 RENAME TO workflow_snapshots;
        COMMIT;
      `);
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

    database.prepare(`
      INSERT INTO app_metadata (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(currentSchemaVersion));

    const quickCheck = database.prepare('PRAGMA quick_check;')
      .all() as unknown as Array<{ quick_check: string }>;
    if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== 'ok') {
      throw new StorageInitializationError(dataDirectory);
    }
    const foreignKeyFailures = database.prepare('PRAGMA foreign_key_check;').all();
    if (foreignKeyFailures.length > 0) {
      throw new StorageInitializationError(dataDirectory);
    }

    const hasAbandonedWork = Boolean(database.prepare(`
      SELECT 1 FROM concept_screen_operations WHERE status = 'running'
      UNION ALL SELECT 1 FROM stage_runs WHERE status = 'running'
      UNION ALL SELECT 1 FROM workflow_candidates WHERE status = 'running'
      LIMIT 1
    `).get());
    if (hasAbandonedWork) {
      const recoveredAt = (options.now ?? (() => new Date()))().toISOString();
      recovery.abandonedOperations = Number(database.prepare(`
        UPDATE concept_screen_operations
        SET status = 'failed', completed_at = ?, error_code = 'generation_interrupted',
            error_message = 'Generation was interrupted before this operation completed.'
        WHERE status = 'running'
      `).run(recoveredAt).changes);
      recovery.abandonedStageRuns = Number(database.prepare(`
        UPDATE stage_runs
        SET status = 'failed', completed_at = ?, error_code = 'generation_interrupted',
            error_message = 'Generation was interrupted before this Stage Run completed.'
        WHERE status = 'running'
      `).run(recoveredAt).changes);
      recovery.abandonedCandidates = Number(database.prepare(`
        UPDATE workflow_candidates
        SET status = 'failed', error_code = 'generation_interrupted',
            error_message = 'Full Generation was interrupted and can be resumed.',
            updated_at = ?
        WHERE status = 'running'
      `).run(recoveredAt).changes);
    }

    const assetEntries = await readdir(join(dataDirectory, 'assets'), {
      withFileTypes: true,
    });
    const importerDirectory = /^(?:(\.)?import-(?<projectId>[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})|\.extract-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
    for (const entry of assetEntries) {
      if (!entry.isDirectory()) continue;
      const match = importerDirectory.exec(entry.name);
      if (!match) continue;
      const projectId = match.groups?.projectId;
      const staging = match[1] === '.' || projectId === undefined;
      const projectExists = !staging && Boolean(database.prepare(
        'SELECT 1 FROM projects WHERE id = ? LIMIT 1',
      ).get(projectId));
      if (!projectExists) {
        await rm(join(dataDirectory, 'assets', entry.name), {
          recursive: true,
          force: true,
        });
      }
    }

    const assetRows = database.prepare(`
      SELECT relative_path, byte_size FROM binary_assets
    `).all() as unknown as AssetRow[];
    const referencedAssets = new Set<string>();
    for (const asset of assetRows) {
      const path = storedAssetPath(dataDirectory, asset.relative_path);
      referencedAssets.add(path);
      const assetStat = await stat(path).catch(() => null);
      if (!assetStat?.isFile() || assetStat.size !== asset.byte_size) {
        throw new StorageInitializationError(dataDirectory);
      }
    }
    for (const path of await listFiles(join(dataDirectory, 'assets'))) {
      if (referencedAssets.has(resolve(path))) continue;
      await unlink(path);
      recovery.orphanAssetsRemoved += 1;
    }
  } catch (error) {
    if (error instanceof StorageInitializationError) throw error;
    throw new StorageInitializationError(dataDirectory, error);
  } finally {
    database.close();
  }

  return { state: 'ready', recovery };
}

export async function readStorageUsage(
  dataDirectory: string,
): Promise<StorageUsage> {
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'), {
      readOnly: true,
    });
  } catch (error) {
    throw new StorageInitializationError(dataDirectory, error);
  }
  try {
    const projects = database.prepare(`
      WITH structured_payloads (project_id, payload_bytes) AS (
        SELECT id,
               length(CAST(id AS BLOB))
               + length(CAST(name AS BLOB))
               + length(CAST(insight_source AS BLOB))
               + length(CAST(created_at AS BLOB))
               + length(CAST(updated_at AS BLOB))
               + length(CAST(name_is_automatic AS BLOB))
        FROM projects
        UNION ALL
        SELECT project_id,
               length(CAST(id AS BLOB))
               + length(CAST(stage_id AS BLOB))
               + length(CAST(run_kind AS BLOB))
               + length(CAST(status AS BLOB))
               + length(CAST(started_at AS BLOB))
               + length(CAST(COALESCE(completed_at, '') AS BLOB))
               + length(CAST(COALESCE(duration_ms, '') AS BLOB))
               + length(CAST(prompt_snapshot AS BLOB))
               + length(CAST(model_snapshot AS BLOB))
               + length(CAST(stage_configuration_updated_at AS BLOB))
               + length(CAST(input_snapshot AS BLOB))
               + length(CAST(COALESCE(input_artifact_id, '') AS BLOB))
               + length(CAST(COALESCE(input_run_id, '') AS BLOB))
               + length(CAST(COALESCE(input_lineage_json, '') AS BLOB))
               + length(CAST(assembled_request AS BLOB))
               + length(CAST(COALESCE(settings_json, '') AS BLOB))
               + length(CAST(COALESCE(attempt_history_json, '') AS BLOB))
               + length(CAST(COALESCE(response_id, '') AS BLOB))
               + length(CAST(COALESCE(request_id, '') AS BLOB))
               + length(CAST(COALESCE(usage_json, '') AS BLOB))
               + length(CAST(COALESCE(validation_json, '') AS BLOB))
               + length(CAST(COALESCE(error_code, '') AS BLOB))
               + length(CAST(COALESCE(error_message, '') AS BLOB))
        FROM stage_runs
        UNION ALL
        SELECT project_id,
               length(CAST(id AS BLOB))
               + length(CAST(stage_id AS BLOB))
               + length(CAST(run_id AS BLOB))
               + length(CAST(markdown AS BLOB))
               + length(CAST(created_at AS BLOB))
               + length(CAST(validation_json AS BLOB))
        FROM artifacts
        UNION ALL
        SELECT project_id,
               length(CAST(project_id AS BLOB))
               + length(CAST(stage_id AS BLOB))
               + length(CAST(artifact_id AS BLOB))
        FROM current_artifacts
        UNION ALL
        SELECT project_id,
               length(CAST(id AS BLOB))
               + length(CAST(insight_source AS BLOB))
               + length(CAST(created_at AS BLOB))
               + length(CAST(updated_at AS BLOB))
        FROM insight_revisions
        UNION ALL
        SELECT project_id,
               length(CAST(id AS BLOB))
               + length(CAST(run_kind AS BLOB))
               + length(CAST(status AS BLOB))
               + length(CAST(current_stage AS BLOB))
               + length(CAST(completed_operation_count AS BLOB))
               + length(CAST(start_stage AS BLOB))
               + length(CAST(insight_source AS BLOB))
               + length(CAST(COALESCE(insight_revision_id, '') AS BLOB))
               + length(CAST(configuration_json AS BLOB))
               + length(CAST(COALESCE(design_brief_run_id, '') AS BLOB))
               + length(CAST(COALESCE(design_brief_artifact_id, '') AS BLOB))
               + length(CAST(COALESCE(concept_screen_run_id, '') AS BLOB))
               + length(CAST(COALESCE(concept_screen_artifact_id, '') AS BLOB))
               + length(CAST(COALESCE(prd_run_id, '') AS BLOB))
               + length(CAST(COALESCE(prd_artifact_id, '') AS BLOB))
               + length(CAST(COALESCE(warnings_json, '') AS BLOB))
               + length(CAST(COALESCE(error_code, '') AS BLOB))
               + length(CAST(COALESCE(error_message, '') AS BLOB))
               + length(CAST(started_at AS BLOB))
               + length(CAST(updated_at AS BLOB))
        FROM workflow_candidates
        UNION ALL
        SELECT project_id,
               length(CAST(id AS BLOB))
               + length(CAST(created_at AS BLOB))
               + length(CAST(preserved_by AS BLOB))
               + length(CAST(replaced_from_stage AS BLOB))
               + length(CAST(insight_source AS BLOB))
               + length(CAST(COALESCE(design_brief_artifact_id, '') AS BLOB))
               + length(CAST(COALESCE(concept_screen_artifact_id, '') AS BLOB))
               + length(CAST(COALESCE(prd_artifact_id, '') AS BLOB))
        FROM workflow_snapshots
        UNION ALL
        SELECT project_id,
               length(CAST(project_id AS BLOB))
               + length(CAST(design_brief_artifact_id AS BLOB))
               + length(CAST(created_at AS BLOB))
        FROM pending_cascades
        UNION ALL
        SELECT project_id,
               length(CAST(id AS BLOB))
               + length(CAST(run_id AS BLOB))
               + length(CAST(relative_path AS BLOB))
               + length(CAST(media_type AS BLOB))
               + length(CAST(byte_size AS BLOB))
               + length(CAST(width AS BLOB))
               + length(CAST(height AS BLOB))
               + length(CAST(created_at AS BLOB))
        FROM binary_assets
        UNION ALL
        SELECT run.project_id,
               length(CAST(operation.run_id AS BLOB))
               + length(CAST(operation.ordinal AS BLOB))
               + length(CAST(operation.status AS BLOB))
               + length(CAST(operation.started_at AS BLOB))
               + length(CAST(COALESCE(operation.completed_at, '') AS BLOB))
               + length(CAST(COALESCE(operation.duration_ms, '') AS BLOB))
               + length(CAST(COALESCE(operation.asset_id, '') AS BLOB))
               + length(CAST(COALESCE(operation.response_id, '') AS BLOB))
               + length(CAST(COALESCE(operation.request_id, '') AS BLOB))
               + length(CAST(COALESCE(operation.usage_json, '') AS BLOB))
               + length(CAST(COALESCE(operation.error_code, '') AS BLOB))
               + length(CAST(COALESCE(operation.error_message, '') AS BLOB))
        FROM concept_screen_operations AS operation
        JOIN stage_runs AS run ON run.id = operation.run_id
      )
      SELECT project.id AS project_id, project.name,
             COALESCE((
               SELECT SUM(payload.payload_bytes)
               FROM structured_payloads AS payload
               WHERE payload.project_id = project.id
             ), 0) AS structured_bytes,
             COALESCE((
               SELECT SUM(asset.byte_size)
               FROM binary_assets AS asset
               WHERE asset.project_id = project.id
             ), 0) AS asset_bytes
      FROM projects AS project
      ORDER BY project.updated_at DESC, project.created_at DESC, project.id ASC
    `).all() as unknown as ProjectUsageRow[];
    const assetBytes = projects.reduce((total, project) =>
      total + Number(project.asset_bytes), 0);
    const databaseBytes = await Promise.all([
      'insightforge.sqlite',
      'insightforge.sqlite-wal',
      'insightforge.sqlite-shm',
    ].map((name) => fileSize(join(dataDirectory, name))))
      .then((sizes) => sizes.reduce((total, size) => total + size, 0));
    const filesystem = await statfs(dataDirectory);
    const availableBytes = Math.min(
      Number.MAX_SAFE_INTEGER,
      Number(filesystem.bavail) * Number(filesystem.bsize),
    );
    return {
      state: 'ready',
      dataDirectory,
      totalBytes: databaseBytes + assetBytes,
      databaseBytes,
      assetBytes,
      availableBytes,
      projects: projects.map((project) => ({
        projectId: project.project_id,
        name: project.name,
        estimatedBytes: Number(project.structured_bytes) + Number(project.asset_bytes),
        structuredBytes: Number(project.structured_bytes),
        assetBytes: Number(project.asset_bytes),
      })),
    };
  } catch (error) {
    if (error instanceof StorageInitializationError) throw error;
    throw new StorageInitializationError(dataDirectory, error);
  } finally {
    database.close();
  }
}

export async function ensureStorageCapacity(
  dataDirectory: string,
  requiredBytes = 64 * 1024 * 1024,
): Promise<void> {
  try {
    await verifyWritable(dataDirectory);
    const usage = await readStorageUsage(dataDirectory);
    if (usage.availableBytes < requiredBytes) {
      throw new StorageCapacityError(usage.availableBytes, requiredBytes);
    }
  } catch (error) {
    if (error instanceof StorageCapacityError) throw error;
    if (error instanceof StorageInitializationError) throw error;
    throw new StorageInitializationError(dataDirectory, error);
  }
}
