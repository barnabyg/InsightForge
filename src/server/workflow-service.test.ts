import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import type { ImageGenerationBoundary } from './image-generation-boundary.js';
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

  function pngFixture(red: number): Buffer {
    const image = new PNG({ width: 1024, height: 768 });
    for (let offset = 0; offset < image.data.length; offset += 4) {
      image.data[offset] = red;
      image.data[offset + 1] = 80;
      image.data[offset + 2] = 120;
      image.data[offset + 3] = 255;
    }
    return PNG.sync.write(image);
  }

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

  it('generates and promotes exactly three coordinated Concept Screens with complete provenance', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'People need a calm way to compare retrofit proposals.',
    });
    const configuration = await openWorkflowConfigurationService(dataDirectory);
    configuration.commitStageConfiguration('concept_screens', {
      prompt: 'Create three coordinated mid-fidelity comparison screens.',
      model: 'gpt-image-2',
      imageQuality: 'medium',
    });
    configuration.close();

    const generatedPngs = [pngFixture(40), pngFixture(80), pngFixture(120)];
    const imageInputs: Parameters<ImageGenerationBoundary['generateConceptScreen']>[0][] = [];
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          return {
            markdown: '# Design Brief\n\n## Primary journey\n\nCompare proposals, inspect trade-offs, and record a decision.',
            responseId: 'resp_brief',
            requestId: 'req_brief',
            usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          imageInputs.push(input);
          return {
            png: generatedPngs[input.ordinal - 1],
            requestId: `req_screen_${input.ordinal}`,
            responseId: null,
            usage: {
              inputTokens: input.ordinal * 100,
              outputTokens: input.ordinal * 200,
              totalTokens: input.ordinal * 300,
            },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await workflows.generateDesignBrief(project.id);

    const generated = await workflows.generateConceptScreens(project.id);

    expect(imageInputs.map((input) => ({
      ordinal: input.ordinal,
      references: input.references.map((reference) => reference.ordinal),
      size: input.size,
      quality: input.quality,
    }))).toEqual([
      { ordinal: 1, references: [], size: 'auto', quality: 'medium' },
      { ordinal: 2, references: [1], size: '1024x768', quality: 'medium' },
      { ordinal: 3, references: [1, 2], size: '1024x768', quality: 'medium' },
    ]);
    expect(generated.conceptScreenSet).toMatchObject({
      stageId: 'concept_screens',
      validation: {
        status: 'valid',
        screenCount: 3,
        width: 1024,
        height: 768,
        warnings: [],
      },
      screens: [
        { ordinal: 1, width: 1024, height: 768, requestId: 'req_screen_1' },
        { ordinal: 2, width: 1024, height: 768, requestId: 'req_screen_2' },
        { ordinal: 3, width: 1024, height: 768, requestId: 'req_screen_3' },
      ],
    });
    expect(generated.lastConceptScreenRun).toMatchObject({
      status: 'succeeded',
      completedOperationCount: 3,
      usage: { inputTokens: 600, outputTokens: 1200, totalTokens: 1800 },
      operations: [
        { ordinal: 1, status: 'succeeded', requestId: 'req_screen_1' },
        { ordinal: 2, status: 'succeeded', requestId: 'req_screen_2' },
        { ordinal: 3, status: 'succeeded', requestId: 'req_screen_3' },
      ],
    });
    for (const screen of generated.conceptScreenSet!.screens) {
      expect(workflows.getConceptScreenAsset(project.id, screen.assetId))
        .toEqual(generatedPngs[screen.ordinal - 1]);
    }
  });

  it('resumes a failed Concept Screen Set without regenerating completed screens', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({ insightSource: 'A comparison journey needs visual structure.' });
    const calls: number[] = [];
    let screenTwoAttempts = 0;
    let currentTime = Date.parse('2026-07-16T12:00:00.000Z');
    const pngs = [pngFixture(30), pngFixture(60), pngFixture(90)];
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          return {
            markdown: '# Design Brief\n\nA three-step comparison journey.',
            responseId: 'resp_brief_resume',
            requestId: 'req_brief_resume',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          calls.push(input.ordinal);
          currentTime += 1_000;
          if (input.ordinal === 2 && screenTwoAttempts++ === 0) {
            throw new GenerationBoundaryError(
              'openai_request_failed',
              'OpenAI could not generate Concept Screen 2.',
              { requestId: 'req_screen_2_failed' },
            );
          }
          return {
            png: pngs[input.ordinal - 1],
            requestId: `req_screen_${input.ordinal}_success`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
      now: () => new Date(currentTime),
    });
    workflowServices.push(workflows);
    await workflows.generateDesignBrief(project.id);

    await expect(workflows.generateConceptScreens(project.id)).rejects.toMatchObject({
      code: 'openai_request_failed',
    });
    const failed = workflows.getProjectWorkflow(project.id);
    expect(failed.conceptScreenSet).toBeNull();
    expect(failed.lastConceptScreenRun).toMatchObject({
      status: 'failed',
      durationMs: 2_000,
      completedOperationCount: 1,
      operations: [
        { ordinal: 1, status: 'succeeded' },
        { ordinal: 2, status: 'failed', requestId: 'req_screen_2_failed' },
      ],
    });

    currentTime += 60_000;
    const resumed = await workflows.generateConceptScreens(project.id);

    expect(calls).toEqual([1, 2, 2, 3]);
    expect(resumed.lastConceptScreenRun?.id).toBe(failed.lastConceptScreenRun?.id);
    expect(resumed.lastConceptScreenRun).toMatchObject({
      status: 'succeeded',
      durationMs: 4_000,
      completedOperationCount: 3,
      usage: { inputTokens: 300, outputTokens: 600, totalTokens: 900 },
    });
    expect(resumed.conceptScreenSet?.screens).toHaveLength(3);
  });

  it('cancels before the next image operation and resumes the completed candidate', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({ insightSource: 'A journey needs three coordinated screens.' });
    const calls: number[] = [];
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let hold = true;
    const pngs = [pngFixture(20), pngFixture(50), pngFixture(80)];
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          return {
            markdown: '# Design Brief\n\nA three-screen journey.',
            responseId: 'resp_cancel_brief',
            requestId: 'req_cancel_brief',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          calls.push(input.ordinal);
          if (input.ordinal === 1 && hold) {
            firstStarted();
            await holdFirst;
          }
          return {
            png: pngs[input.ordinal - 1],
            requestId: `req_cancel_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await workflows.generateDesignBrief(project.id);

    const generation = workflows.generateConceptScreens(project.id);
    await started;
    expect(workflows.cancelConceptScreens(project.id)).toBe(true);
    releaseFirst();
    await expect(generation).rejects.toMatchObject({ code: 'cancelled' });

    const cancelled = workflows.getProjectWorkflow(project.id);
    expect(calls).toEqual([1]);
    expect(cancelled.conceptScreenSet).toBeNull();
    expect(cancelled.lastConceptScreenRun).toMatchObject({
      status: 'cancelled',
      completedOperationCount: 1,
    });

    hold = false;
    const resumed = await workflows.generateConceptScreens(project.id);
    expect(calls).toEqual([1, 2, 3]);
    expect(resumed.lastConceptScreenRun?.id).toBe(cancelled.lastConceptScreenRun?.id);
    expect(resumed.conceptScreenSet?.screens).toHaveLength(3);
  });

  it('rejects inconsistent Concept Screen dimensions without promoting a partial set', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({ insightSource: 'A visual journey needs consistency.' });
    const portrait = new PNG({ width: 768, height: 1024 });
    portrait.data.fill(160);
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          return {
            markdown: '# Design Brief\n\nA coordinated visual journey.',
            responseId: 'resp_validation_brief',
            requestId: 'req_validation_brief',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          return {
            png: input.ordinal === 1 ? pngFixture(25) : PNG.sync.write(portrait),
            requestId: `req_validation_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await workflows.generateDesignBrief(project.id);

    await expect(workflows.generateConceptScreens(project.id)).rejects.toMatchObject({
      code: 'invalid_artifact',
      message: 'Concept Screen 2 dimensions do not match Concept Screen 1.',
    });
    expect(workflows.getProjectWorkflow(project.id)).toMatchObject({
      conceptScreenSet: null,
      lastConceptScreenRun: {
        status: 'failed',
        completedOperationCount: 1,
        operations: [
          { ordinal: 1, status: 'succeeded' },
          {
            ordinal: 2,
            status: 'failed',
            requestId: 'req_validation_2',
            error: { code: 'invalid_artifact' },
          },
        ],
      },
    });
  });
});
