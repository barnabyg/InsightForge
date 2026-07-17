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

  function prdNotExpected() {
    return {
      async generatePrd(): Promise<never> {
        throw new Error('PRD generation was not expected in this scenario.');
      },
    };
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
        ...prdNotExpected(),
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
        ...prdNotExpected(),
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
        ...prdNotExpected(),
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
        ...prdNotExpected(),
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
    const progressPhases: string[] = [];
    const unsubscribe = workflows.subscribeConceptScreenProgress(
      project.id,
      (event) => progressPhases.push(event.phase),
    );

    const generated = await workflows.generateConceptScreens(project.id);
    unsubscribe();

    expect(progressPhases).toEqual([
      'generating',
      'generating',
      'generating',
      'validating',
      'promoting',
      'completed',
    ]);
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
      stageInput: {
        artifactId: generated.designBrief?.id,
        runId: generated.designBrief?.runId,
      },
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

    const cascaded = await workflows.generateDesignBrief(project.id);
    expect(imageInputs).toHaveLength(6);
    expect(cascaded.designBrief?.runId).not.toBe(generated.designBrief?.runId);
    expect(cascaded.conceptScreenSet?.runId).not.toBe(generated.conceptScreenSet?.runId);
    expect(cascaded.lastConceptScreenRun?.stageInput).toMatchObject({
      artifactId: cascaded.designBrief?.id,
      runId: cascaded.designBrief?.runId,
    });
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
    const mismatched = new PNG({ width: 768, height: 1024 });
    mismatched.data.fill(110);
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        ...prdNotExpected(),
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
            return {
              png: PNG.sync.write(mismatched),
              requestId: 'req_screen_2_failed',
              responseId: null,
              usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
            };
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
      code: 'invalid_artifact',
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
      usage: { inputTokens: 400, outputTokens: 800, totalTokens: 1200 },
      attemptHistory: [{
        status: 'failed',
        usage: { inputTokens: 200, outputTokens: 400, totalTokens: 600 },
        error: { code: 'invalid_artifact' },
        operations: [
          { ordinal: 1, status: 'succeeded' },
          { ordinal: 2, status: 'failed', requestId: 'req_screen_2_failed' },
        ],
      }],
    });
    expect(resumed.conceptScreenSet?.screens).toHaveLength(3);
  });

  it('persists a failed cascade candidate and resumes its exact lineage after restart', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({ insightSource: 'A cascade must remain coherent across restart.' });
    const pngs = [pngFixture(35), pngFixture(65), pngFixture(95)];
    let briefVersion = 0;
    let screenTwoAttempts = 0;
    const firstCalls: number[] = [];
    const firstWorkflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        ...prdNotExpected(),
        async generateDesignBrief() {
          briefVersion += 1;
          return {
            markdown: `# Design Brief\n\nVersion ${briefVersion}`,
            responseId: `resp_brief_${briefVersion}`,
            requestId: `req_brief_${briefVersion}`,
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          firstCalls.push(input.ordinal);
          if (input.ordinal === 2 && screenTwoAttempts++ === 1) {
            throw new GenerationBoundaryError(
              'openai_request_failed',
              'Cascade screen two failed safely.',
              { requestId: 'req_cascade_screen_2_failed' },
            );
          }
          return {
            png: pngs[input.ordinal - 1],
            requestId: `req_cascade_${briefVersion}_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(firstWorkflows);
    await firstWorkflows.generateDesignBrief(project.id);
    const original = await firstWorkflows.generateConceptScreens(project.id);

    await expect(firstWorkflows.generateDesignBrief(project.id)).rejects.toMatchObject({
      code: 'openai_request_failed',
    });
    const failed = firstWorkflows.getProjectWorkflow(project.id);
    expect(failed.designBrief?.id).toBe(original.designBrief?.id);
    expect(failed.conceptScreenSet?.id).toBe(original.conceptScreenSet?.id);
    const candidateLineage = failed.lastConceptScreenRun!.stageInput;
    expect(candidateLineage.artifactId).not.toBe(original.designBrief?.id);
    expect(firstCalls).toEqual([1, 2, 3, 1, 2]);

    firstWorkflows.close();
    workflowServices.splice(workflowServices.indexOf(firstWorkflows), 1);
    const resumedCalls: number[] = [];
    const resumedWorkflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        ...prdNotExpected(),
        async generateDesignBrief() {
          throw new Error('Design Brief regeneration was not expected during resume.');
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          resumedCalls.push(input.ordinal);
          return {
            png: pngs[input.ordinal - 1],
            requestId: `req_resumed_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(resumedWorkflows);

    const resumed = await resumedWorkflows.generateConceptScreens(project.id);
    expect(resumedCalls).toEqual([2, 3]);
    expect(resumed.designBrief).toMatchObject({
      id: candidateLineage.artifactId,
      runId: candidateLineage.runId,
    });
    expect(resumed.lastConceptScreenRun?.id).toBe(failed.lastConceptScreenRun?.id);
    expect(resumed.lastConceptScreenRun?.stageInput).toEqual(candidateLineage);
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
        ...prdNotExpected(),
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
        ...prdNotExpected(),
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
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
            error: { code: 'invalid_artifact' },
          },
        ],
        usage: { inputTokens: 200, outputTokens: 400, totalTokens: 600 },
      },
    });
  });

  it('generates and persists a read-only PRD from only the current Design Brief and Concept Screen Set', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'ORIGINAL_INSIGHT_MUST_NOT_BE_A_SEPARATE_PRD_INPUT',
    });
    const configuration = await openWorkflowConfigurationService(dataDirectory);
    configuration.commitStageConfiguration('prd', {
      prompt: 'Create a rigorous PRD that reconciles the brief and all three screens.',
      model: 'gpt-5.4-mini',
      imageQuality: null,
    });
    configuration.close();

    const designBrief = '# Design Brief\n\n## Primary journey\n\nCompare three options and preserve the reasoning behind the final choice.';
    const prdMarkdown = '# PRD\n\n## Overview\n\nA focused requirements document reconciles the three concept screens with the authoritative design brief.';
    const pngs = [pngFixture(45), pngFixture(85), pngFixture(125)];
    let receivedPrdInput: {
      model: string;
      stagePrompt: string;
      designBrief: string;
      conceptScreens: Array<{ ordinal: number; png: Uint8Array }>;
    } | undefined;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        ...prdNotExpected(),
        async generateDesignBrief() {
          return {
            markdown: designBrief,
            responseId: 'resp_prd_brief',
            requestId: 'req_prd_brief',
            usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
          };
        },
        async generatePrd(input) {
          receivedPrdInput = input;
          return {
            markdown: prdMarkdown,
            responseId: 'resp_prd_01',
            requestId: 'req_prd_01',
            usage: { inputTokens: 640, outputTokens: 180, totalTokens: 820 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          return {
            png: pngs[input.ordinal - 1],
            requestId: `req_prd_screen_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await workflows.generateDesignBrief(project.id);
    const withScreens = await workflows.generateConceptScreens(project.id);

    const generated = await workflows.generatePrd(project.id);

    expect(receivedPrdInput).toMatchObject({
      model: 'gpt-5.4-mini',
      stagePrompt: 'Create a rigorous PRD that reconciles the brief and all three screens.',
      designBrief,
      conceptScreens: [
        { ordinal: 1 },
        { ordinal: 2 },
        { ordinal: 3 },
      ],
    });
    expect(receivedPrdInput).not.toHaveProperty('insightSource');
    expect(receivedPrdInput?.conceptScreens.map(({ png }) => Buffer.from(png)))
      .toEqual(pngs);
    expect(generated.prd).toMatchObject({
      stageId: 'prd',
      markdown: prdMarkdown,
      validation: {
        status: 'valid_with_warnings',
        wordCount: 16,
        warnings: [{
          code: 'below_recommended_word_count',
          message: 'PRD is 16 words; the recommended minimum is 250.',
        }],
      },
    });
    expect(generated.lastPrdRun).toMatchObject({
      status: 'succeeded',
      model: 'gpt-5.4-mini',
      responseId: 'resp_prd_01',
      requestId: 'req_prd_01',
      usage: { inputTokens: 640, outputTokens: 180, totalTokens: 820 },
      stageInput: {
        designBrief: {
          artifactId: withScreens.designBrief?.id,
          runId: withScreens.designBrief?.runId,
          value: designBrief,
        },
        conceptScreenSet: {
          artifactId: withScreens.conceptScreenSet?.id,
          runId: withScreens.conceptScreenSet?.runId,
          screens: withScreens.conceptScreenSet?.screens.map((screen) => ({
            assetId: screen.assetId,
            ordinal: screen.ordinal,
            width: screen.width,
            height: screen.height,
          })),
        },
      },
    });
    expect(generated.lastPrdRun?.assembledRequest).not.toContain(project.insightSource);
    expect(projects.listProjects()[0]).toMatchObject({
      id: project.id,
      prdPresent: true,
    });
    expect(generated).toMatchObject({
      canGenerateDesignBrief: false,
      generationBlocker: 'Regenerate the complete downstream workflow to replace a current PRD consistently.',
      canGenerateConceptScreens: false,
      conceptScreenGenerationBlocker: 'Regenerate the PRD with any new Concept Screen Set to keep the workflow consistent.',
      canGeneratePrd: true,
    });
    await expect(workflows.generateDesignBrief(project.id)).rejects.toThrow(
      'Regenerate the complete downstream workflow to replace a current PRD consistently.',
    );
    await expect(workflows.generateConceptScreens(project.id)).rejects.toThrow(
      'Regenerate the PRD with any new Concept Screen Set to keep the workflow consistent.',
    );

    workflows.close();
    workflowServices.splice(workflowServices.indexOf(workflows), 1);
    const reopened = await openWorkflowService(dataDirectory, {
      textGeneration: {
        ...prdNotExpected(),
        async generateDesignBrief() {
          throw new Error('No generation should occur while reading.');
        },
        async generatePrd() {
          throw new Error('No generation should occur while reading.');
        },
      },
    });
    workflowServices.push(reopened);
    expect(reopened.getProjectWorkflow(project.id).prd).toEqual(generated.prd);
  });

  it('rejects PRD generation while a failed upstream cascade candidate is pending', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({ insightSource: 'Keep candidate lineage coherent.' });
    let briefVersion = 0;
    let failCascade = false;
    let prdCalls = 0;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          briefVersion += 1;
          return {
            markdown: `# Design Brief\n\nVersion ${briefVersion}`,
            responseId: `resp_brief_${briefVersion}`,
            requestId: `req_brief_${briefVersion}`,
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
        async generatePrd() {
          prdCalls += 1;
          return {
            markdown: '# PRD\n\nMust not run for mixed inputs.',
            responseId: 'resp_unexpected_prd',
            requestId: 'req_unexpected_prd',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          if (failCascade && input.ordinal === 1) {
            throw new GenerationBoundaryError(
              'openai_request_failed',
              'Candidate screen generation failed safely.',
            );
          }
          return {
            png: pngFixture(input.ordinal * 30),
            requestId: `req_screen_${briefVersion}_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await workflows.generateDesignBrief(project.id);
    await workflows.generateConceptScreens(project.id);

    failCascade = true;
    await expect(workflows.generateDesignBrief(project.id)).rejects.toMatchObject({
      code: 'openai_request_failed',
    });
    await expect(workflows.generatePrd(project.id)).rejects.toThrow(
      'Finish or resume the pending downstream cascade before generating a PRD.',
    );
    expect(prdCalls).toBe(0);
  });

  it('serializes PRD and Concept Screen generation for each Project', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({ insightSource: 'Do not overlap workflow generations.' });
    let holdConcept = false;
    let conceptStarted!: () => void;
    let releaseConcept!: () => void;
    const conceptDidStart = new Promise<void>((resolve) => { conceptStarted = resolve; });
    const conceptCanFinish = new Promise<void>((resolve) => { releaseConcept = resolve; });
    let prdStarted!: () => void;
    let releasePrd!: () => void;
    const prdDidStart = new Promise<void>((resolve) => { prdStarted = resolve; });
    const prdCanFinish = new Promise<void>((resolve) => { releasePrd = resolve; });
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          return {
            markdown: '# Design Brief\n\nA coherent three-screen journey.',
            responseId: 'resp_serial_brief',
            requestId: 'req_serial_brief',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
        async generatePrd() {
          prdStarted();
          await prdCanFinish;
          return {
            markdown: '# PRD\n\nA coherent final artifact.',
            responseId: 'resp_serial_prd',
            requestId: 'req_serial_prd',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          if (holdConcept && input.ordinal === 1) {
            conceptStarted();
            await conceptCanFinish;
          }
          return {
            png: pngFixture(input.ordinal * 35),
            requestId: `req_serial_screen_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await workflows.generateDesignBrief(project.id);
    await workflows.generateConceptScreens(project.id);

    holdConcept = true;
    const conceptGeneration = workflows.generateConceptScreens(project.id);
    await conceptDidStart;
    await expect(workflows.generatePrd(project.id)).rejects.toThrow(
      'Concept Screen generation is already running for this Project.',
    );
    releaseConcept();
    await conceptGeneration;

    const prdGeneration = workflows.generatePrd(project.id);
    await prdDidStart;
    await expect(workflows.generateConceptScreens(project.id)).rejects.toThrow(
      'PRD generation is already running for this Project.',
    );
    releasePrd();
    await prdGeneration;
  });

  it('rejects PRD generation while a Design Brief rerun is in flight', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({ insightSource: 'Serialize the earliest stage too.' });
    let briefCalls = 0;
    let briefRerunStarted!: () => void;
    let releaseBriefRerun!: () => void;
    const briefDidStart = new Promise<void>((resolve) => { briefRerunStarted = resolve; });
    const briefCanFinish = new Promise<void>((resolve) => { releaseBriefRerun = resolve; });
    let prdCalls = 0;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          briefCalls += 1;
          if (briefCalls === 2) {
            briefRerunStarted();
            await briefCanFinish;
          }
          return {
            markdown: `# Design Brief\n\nVersion ${briefCalls}`,
            responseId: `resp_held_brief_${briefCalls}`,
            requestId: `req_held_brief_${briefCalls}`,
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
        async generatePrd() {
          prdCalls += 1;
          return {
            markdown: '# PRD\n\nMust not overlap the Design Brief.',
            responseId: 'resp_overlap_prd',
            requestId: 'req_overlap_prd',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          return {
            png: pngFixture(input.ordinal * 40),
            requestId: `req_held_screen_${briefCalls}_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await workflows.generateDesignBrief(project.id);
    await workflows.generateConceptScreens(project.id);

    const briefRerun = workflows.generateDesignBrief(project.id);
    await briefDidStart;
    await expect(workflows.generatePrd(project.id)).rejects.toThrow(
      'Design Brief generation is already running for this Project.',
    );
    expect(prdCalls).toBe(0);
    releaseBriefRerun();
    await briefRerun;
  });
});
