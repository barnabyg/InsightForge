import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  CreateProjectInput,
  Project,
  ProjectSummary,
} from '../shared/projects.js';
import { initializeStorage } from './storage.js';
import { readWorkflowRerunPlan } from './workflow-update-analysis.js';

interface ProjectRow {
  id: string;
  name: string;
  insight_source: string;
  created_at: string;
  updated_at: string;
  name_is_automatic: number;
  design_brief_present?: number;
  concept_screen_set_present?: number;
  prd_present?: number;
}

export interface ProjectServiceOptions {
  now?: () => Date;
}

export interface ProjectService {
  createProject(input?: CreateProjectInput): Project;
  getProject(id: string): Project | null;
  listProjects(): ProjectSummary[];
  renameProject(id: string, name: string): Project;
  updateInsightSource(id: string, insightSource: string): Project;
  duplicateProject(id: string): Project;
  deleteProject(id: string): void;
  close(): void;
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} was not found`);
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectInsightLockedError extends Error {
  constructor() {
    super('Insight Source is locked after generation');
    this.name = 'ProjectInsightLockedError';
  }
}

function deriveProjectName(insightSource: string): string {
  const firstMeaningfulLine = insightSource
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^#{1,6}\s+/, '')
    .trim();

  return firstMeaningfulLine?.slice(0, 80) || 'Untitled Project';
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    insightSource: row.insight_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function openProjectService(
  dataDirectory: string,
  options: ProjectServiceOptions = {},
): Promise<ProjectService> {
  await initializeStorage(dataDirectory);
  const database = new DatabaseSync(join(dataDirectory, 'insightforge.sqlite'));
  database.exec('PRAGMA foreign_keys = ON;');
  const now = options.now ?? (() => new Date());

  function requireProject(id: string): Project {
    const row = database.prepare(`
      SELECT id, name, insight_source, created_at, updated_at, name_is_automatic
      FROM projects
      WHERE id = ?
    `).get(id) as unknown as ProjectRow | undefined;

    if (!row) {
      throw new ProjectNotFoundError(id);
    }
    return rowToProject(row);
  }

  return {
    createProject(input = {}) {
      const id = randomUUID();
      const insightSource = input.insightSource ?? '';
      const hasExplicitName = Boolean(input.name?.trim());
      const name = hasExplicitName
        ? input.name!.trim()
        : deriveProjectName(insightSource);
      const timestamp = now().toISOString();

      database.prepare(`
        INSERT INTO projects (
          id, name, insight_source, created_at, updated_at, name_is_automatic
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, name, insightSource, timestamp, timestamp, hasExplicitName ? 0 : 1);

      return {
        id,
        name,
        insightSource,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },

    getProject(id) {
      try {
        return requireProject(id);
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          return null;
        }
        throw error;
      }
    },

    listProjects() {
      const rows = database.prepare(`
        SELECT project.id, project.name, project.insight_source,
               project.created_at, project.updated_at, project.name_is_automatic,
               EXISTS (
                 SELECT 1 FROM current_artifacts AS current
                 WHERE current.project_id = project.id
                   AND current.stage_id = 'design_brief'
               ) AS design_brief_present,
               EXISTS (
                 SELECT 1 FROM current_artifacts AS current
                 WHERE current.project_id = project.id
                   AND current.stage_id = 'concept_screens'
               ) AS concept_screen_set_present,
               EXISTS (
                 SELECT 1 FROM current_artifacts AS current
                 WHERE current.project_id = project.id
                   AND current.stage_id = 'prd'
               ) AS prd_present
        FROM projects AS project
        ORDER BY updated_at DESC, created_at DESC, id ASC
      `).all() as unknown as ProjectRow[];

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        updatedAt: row.updated_at,
        insightSourcePresent: row.insight_source.trim().length > 0,
        designBriefPresent: row.design_brief_present === 1,
        conceptScreenSetPresent: row.concept_screen_set_present === 1,
        prdPresent: row.prd_present === 1,
        updateAvailable: readWorkflowRerunPlan(database, row.id) !== null,
      }));
    },

    renameProject(id, name) {
      const normalizedName = name.trim();
      if (!normalizedName) {
        throw new TypeError('Project name cannot be empty');
      }

      const result = database.prepare(`
        UPDATE projects
        SET name = ?, updated_at = ?, name_is_automatic = 0
        WHERE id = ?
      `).run(normalizedName.slice(0, 120), now().toISOString(), id);
      if (result.changes === 0) {
        throw new ProjectNotFoundError(id);
      }
      return requireProject(id);
    },

    updateInsightSource(id, insightSource) {
      requireProject(id);
      const hasGeneratedArtifact = database.prepare(`
        SELECT 1
        FROM current_artifacts
        WHERE project_id = ? AND stage_id = 'design_brief'
      `).get(id);
      if (hasGeneratedArtifact) {
        throw new ProjectInsightLockedError();
      }
      const timestamp = now().toISOString();
      const result = database.prepare(`
        UPDATE projects
        SET insight_source = ?,
            name = CASE
              WHEN name_is_automatic = 1 THEN ?
              ELSE name
            END,
            updated_at = ?
        WHERE id = ?
      `).run(insightSource, deriveProjectName(insightSource), timestamp, id);
      if (result.changes === 0) {
        throw new ProjectNotFoundError(id);
      }
      return requireProject(id);
    },

    duplicateProject(id) {
      const source = requireProject(id);
      const duplicateId = randomUUID();
      const timestamp = now().toISOString();
      const name = `${source.name} — Copy`.slice(0, 120);
      database.prepare(`
        INSERT INTO projects (
          id, name, insight_source, created_at, updated_at, name_is_automatic
        ) VALUES (?, ?, ?, ?, ?, 0)
      `).run(
        duplicateId,
        name,
        source.insightSource,
        timestamp,
        timestamp,
      );
      return requireProject(duplicateId);
    },

    deleteProject(id) {
      const result = database.prepare('DELETE FROM projects WHERE id = ?').run(id);
      if (result.changes === 0) {
        throw new ProjectNotFoundError(id);
      }
    },

    close() {
      database.close();
    },
  };
}
