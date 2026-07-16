import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openProjectService, type ProjectService } from './project-service.js';
import { openWorkflowConfigurationService } from './workflow-configuration-service.js';
import {
  GenerationBoundaryError,
  openWorkflowService,
  type WorkflowService,
} from './workflow-service.js';

describe('Workflow service', () => {
  const temporaryDirectories: string[] = [];
  const projectServices: ProjectService[] = [];
  const workflowServices: WorkflowService[] = [];

  afterEach(async () => {
    workflowServices.splice(0).forEach((service) => service.close());
    projectServices.splice(0).forEach((service) => service.close());
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it('generates, validates, and persists a read-only Design Brief with complete provenance', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory, {
      now: () => new Date('2026-07-16T16:00:00.000Z'),
    });
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'People abandon home-energy upgrades because installer quotes hide important trade-offs.',
    });
    const configuration = await openWorkflowConfigurationService(dataDirectory);
    configuration.commitStageConfiguration('design_brief', {
      prompt: 'Create a focused Design Brief and preserve uncertainty.',
      model: 'gpt-5.4-mini',
      imageQuality: null,
    });
    configuration.close();
    const times = [
      new Date('2026-07-16T16:01:00.000Z'),
      new Date('2026-07-16T16:01:02.500Z'),
    ];
    const workflows = await openWorkflowService(dataDirectory, {
      now: () => times.shift() ?? new Date('2026-07-16T16:01:02.500Z'),
      textGeneration: {
        async generateDesignBrief() {
          return {
            markdown: '# Design Brief\n\n## Problem\n\nInstaller proposals make meaningful comparison difficult.\n\n## Desired outcome\n\nAuthors can identify trade-offs before committing.',
            responseId: 'resp_design_brief_01',
            requestId: 'req_design_brief_01',
            usage: { inputTokens: 143, outputTokens: 61, totalTokens: 204 },
          };
        },
      },
    });
    workflowServices.push(workflows);

    const generated = await workflows.generateDesignBrief(project.id);

    expect(generated.designBrief).toMatchObject({
      stageId: 'design_brief',
      markdown: '# Design Brief\n\n## Problem\n\nInstaller proposals make meaningful comparison difficult.\n\n## Desired outcome\n\nAuthors can identify trade-offs before committing.',
      createdAt: '2026-07-16T16:01:02.500Z',
      validation: {
        status: 'valid_with_warnings',
        wordCount: 18,
        warnings: [{
          code: 'below_recommended_word_count',
          message: 'Design Brief is 18 words; the recommended minimum is 250.',
        }],
      },
    });
    expect(generated.lastDesignBriefRun).toMatchObject({
      status: 'succeeded',
      startedAt: '2026-07-16T16:01:00.000Z',
      completedAt: '2026-07-16T16:01:02.500Z',
      durationMs: 2500,
      model: 'gpt-5.4-mini',
      stageInput: {
        name: 'Insight Source',
        value: project.insightSource,
      },
      responseId: 'resp_design_brief_01',
      requestId: 'req_design_brief_01',
      usage: { inputTokens: 143, outputTokens: 61, totalTokens: 204 },
    });
    expect(generated.lastDesignBriefRun?.stagePrompt)
      .toBe('Create a focused Design Brief and preserve uncertainty.');
    expect(generated.lastDesignBriefRun?.assembledRequest).toContain(
      project.insightSource,
    );
    expect(projects.listProjects()[0]).toMatchObject({
      id: project.id,
      designBriefPresent: true,
    });
    expect(() => projects.updateInsightSource(
      project.id,
      'A replacement that would make the Project internally inconsistent.',
    )).toThrow('Insight Source is locked after generation');
    expect(projects.getProject(project.id)?.insightSource).toBe(project.insightSource);

    workflows.close();
    workflowServices.splice(workflowServices.indexOf(workflows), 1);
    const reopened = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          throw new Error('No generation should occur while reading');
        },
      },
    });
    workflowServices.push(reopened);
    expect(reopened.getProjectWorkflow(project.id).designBrief)
      .toEqual(generated.designBrief);
  });

  it('records a safe failed Stage Run without exposing a partial Artifact', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'Support teams lose the decision trail during complex incident handovers.',
    });
    const times = [
      new Date('2026-07-16T16:10:00.000Z'),
      new Date('2026-07-16T16:10:01.250Z'),
    ];
    const workflows = await openWorkflowService(dataDirectory, {
      now: () => times.shift() ?? new Date('2026-07-16T16:10:01.250Z'),
      textGeneration: {
        async generateDesignBrief() {
          throw new GenerationBoundaryError(
            'openai_refusal',
            'OpenAI declined to generate this Design Brief.',
            { requestId: 'req_refusal_01' },
          );
        },
      },
    });
    workflowServices.push(workflows);

    await expect(workflows.generateDesignBrief(project.id)).rejects.toMatchObject({
      code: 'openai_refusal',
      message: 'OpenAI declined to generate this Design Brief.',
    });

    expect(workflows.getProjectWorkflow(project.id)).toMatchObject({
      designBrief: null,
      lastDesignBriefRun: {
        status: 'failed',
        completedAt: '2026-07-16T16:10:01.250Z',
        durationMs: 1250,
        requestId: 'req_refusal_01',
        validation: null,
        error: {
          code: 'openai_refusal',
          message: 'OpenAI declined to generate this Design Brief.',
        },
      },
    });
  });
});
