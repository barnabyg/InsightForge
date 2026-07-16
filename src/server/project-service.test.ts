import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openProjectService, type ProjectService } from './project-service.js';

describe('Project service', () => {
  const temporaryDirectories: string[] = [];
  const services: ProjectService[] = [];

  async function createService(now = () => new Date('2026-07-16T12:00:00.000Z')) {
    const directory = await mkdtemp(join(tmpdir(), 'insightforge-projects-'));
    temporaryDirectories.push(directory);
    const service = await openProjectService(directory, { now });
    services.push(service);
    return service;
  }

  afterEach(async () => {
    services.splice(0).forEach((service) => service.close());
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('creates and retrieves a locally persisted Project from an Insight Source', async () => {
    const service = await createService();

    const created = service.createProject({
      insightSource: '\n  # Reduce abandoned onboarding\nCustomers stop at identity checks.',
    });

    expect(created).toMatchObject({
      name: 'Reduce abandoned onboarding',
      insightSource: '\n  # Reduce abandoned onboarding\nCustomers stop at identity checks.',
      createdAt: '2026-07-16T12:00:00.000Z',
      updatedAt: '2026-07-16T12:00:00.000Z',
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(service.getProject(created.id)).toEqual(created);
    expect(service.listProjects()).toEqual([
      {
        id: created.id,
        name: 'Reduce abandoned onboarding',
        updatedAt: '2026-07-16T12:00:00.000Z',
        insightSourcePresent: true,
        designBriefPresent: false,
      },
    ]);
  });

  it('autosaves Insight text, supports renaming, and reloads the Project after restart', async () => {
    let currentTime = '2026-07-16T12:10:00.000Z';
    const service = await createService(() => new Date(currentTime));
    const created = service.createProject();
    expect(created.name).toBe('Untitled Project');

    currentTime = '2026-07-16T12:11:00.000Z';
    const withInsight = service.updateInsightSource(
      created.id,
      'Make incident handovers less fragile\nCapture decisions as they happen.',
    );
    expect(withInsight).toMatchObject({
      name: 'Make incident handovers less fragile',
      insightSource: 'Make incident handovers less fragile\nCapture decisions as they happen.',
      updatedAt: '2026-07-16T12:11:00.000Z',
    });

    currentTime = '2026-07-16T12:12:00.000Z';
    const renamed = service.renameProject(created.id, 'Reliable handovers');
    expect(renamed).toMatchObject({
      name: 'Reliable handovers',
      updatedAt: '2026-07-16T12:12:00.000Z',
    });

    currentTime = '2026-07-16T12:13:00.000Z';
    service.updateInsightSource(created.id, 'A completely different first line');
    expect(service.getProject(created.id)?.name).toBe('Reliable handovers');

    service.close();
    services.splice(services.indexOf(service), 1);
    const reopened = await openProjectService(temporaryDirectories[0], {
      now: () => new Date(currentTime),
    });
    services.push(reopened);
    expect(reopened.getProject(created.id)).toMatchObject({
      id: created.id,
      name: 'Reliable handovers',
      insightSource: 'A completely different first line',
      updatedAt: '2026-07-16T12:13:00.000Z',
    });
  });

  it('duplicates one Project and deletes it without changing unrelated Projects', async () => {
    let currentTime = '2026-07-16T13:00:00.000Z';
    const service = await createService(() => new Date(currentTime));
    const original = service.createProject({
      name: 'Faster research synthesis',
      insightSource: 'Researchers lose decisions across interview notes.',
    });
    currentTime = '2026-07-16T13:01:00.000Z';
    const unrelated = service.createProject({
      name: 'Quiet notifications',
      insightSource: 'Alerts interrupt deep work.',
    });

    currentTime = '2026-07-16T13:02:00.000Z';
    const duplicate = service.duplicateProject(original.id);

    expect(duplicate).toMatchObject({
      name: 'Faster research synthesis — Copy',
      insightSource: original.insightSource,
      createdAt: '2026-07-16T13:02:00.000Z',
      updatedAt: '2026-07-16T13:02:00.000Z',
    });
    expect(duplicate.id).not.toBe(original.id);
    expect(service.listProjects().map(({ id }) => id)).toEqual([
      duplicate.id,
      unrelated.id,
      original.id,
    ]);

    service.deleteProject(duplicate.id);
    expect(service.getProject(duplicate.id)).toBeNull();
    expect(service.getProject(original.id)).toEqual(original);
    expect(service.getProject(unrelated.id)).toEqual(unrelated);
  });
});
