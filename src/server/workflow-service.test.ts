import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
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

  async function completeFullWorkflow(
    workflows: WorkflowService,
    projectId: string,
  ) {
    let workflow = await workflows.generateFullWorkflow(projectId);
    while (workflow.candidate?.status === 'paused') {
      workflow = await workflows.resumeFullWorkflow(projectId);
    }
    return workflow;
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

  it('does not replace a partial current workflow without snapshot preservation', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'A current partial workflow must remain untouched until safe regeneration exists.',
    });
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        ...prdNotExpected(),
        async generateDesignBrief() {
          return {
            markdown: '# Design Brief\n\nPreserve this current partial workflow.',
            responseId: 'resp_partial_current_brief',
            requestId: 'req_partial_current_brief',
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          };
        },
      },
    });
    workflowServices.push(workflows);

    await workflows.generateDesignBrief(project.id);

    expect(workflows.getProjectWorkflow(project.id)).toMatchObject({
      canGenerateFullWorkflow: false,
      fullGenerationBlocker: 'Use safe regeneration to replace a current workflow.',
      designBrief: { markdown: '# Design Brief\n\nPreserve this current partial workflow.' },
    });
    await expect(workflows.generateFullWorkflow(project.id)).rejects.toThrow(
      'Use safe regeneration to replace a current workflow.',
    );
  });

  it('generates the complete workflow without exposing partial candidate artifacts', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'Authors need one safe action that turns an insight into a coherent product workflow.',
    });
    const calls: string[] = [];
    let releasePrd!: () => void;
    let prdStarted!: () => void;
    const waitForPrd = new Promise<void>((resolve) => { prdStarted = resolve; });
    const holdPrd = new Promise<void>((resolve) => { releasePrd = resolve; });
    const longBrief = `# Design Brief\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`;
    const longPrd = `# Product Requirements Document\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          calls.push('design_brief');
          return {
            markdown: longBrief,
            responseId: 'resp_full_brief',
            requestId: 'req_full_brief',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          calls.push('prd');
          prdStarted();
          await holdPrd;
          return {
            markdown: longPrd,
            responseId: 'resp_full_prd',
            requestId: 'req_full_prd',
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          calls.push(`concept_screen_${input.ordinal}`);
          return {
            png: pngFixture(input.ordinal * 40),
            requestId: `req_full_screen_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);

    const afterDesignBrief = await workflows.generateFullWorkflow(project.id);
    expect(calls).toEqual(['design_brief']);
    expect(afterDesignBrief.candidate).toMatchObject({
      status: 'paused',
      currentStage: 'concept_screens',
      completedOperationCount: 1,
    });
    const afterConceptScreens = await workflows.resumeFullWorkflow(project.id);
    expect(calls).toEqual([
      'design_brief',
      'concept_screen_1',
      'concept_screen_2',
      'concept_screen_3',
    ]);
    expect(afterConceptScreens.candidate).toMatchObject({
      status: 'paused',
      currentStage: 'prd',
      completedOperationCount: 4,
    });
    const generation = workflows.resumeFullWorkflow(project.id);
    await waitForPrd;

    expect(workflows.getProjectWorkflow(project.id)).toMatchObject({
      designBrief: null,
      conceptScreenSet: null,
      prd: null,
      candidate: {
        status: 'running',
        currentStage: 'prd',
        completedOperationCount: 4,
      },
    });
    await expect(workflows.generateConceptScreens(project.id)).rejects.toThrow(
      'Full Generation is already running for this Project.',
    );

    releasePrd();
    const awaitingPromotion = await generation;

    expect(calls).toEqual([
      'design_brief',
      'concept_screen_1',
      'concept_screen_2',
      'concept_screen_3',
      'prd',
    ]);
    expect(awaitingPromotion).toMatchObject({
      designBrief: null,
      conceptScreenSet: null,
      prd: null,
      candidate: {
        status: 'awaiting_promotion',
        currentStage: 'promotion',
        completedOperationCount: 5,
      },
    });
    const generated = workflows.promoteFullWorkflow(project.id);
    expect(generated).toMatchObject({
      designBrief: { markdown: longBrief.trim() },
      conceptScreenSet: { screens: [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }] },
      prd: { markdown: longPrd.trim() },
      candidate: null,
    });
    expect(generated).toMatchObject({
      canGenerateFullWorkflow: false,
      fullGenerationBlocker: 'Use safe regeneration to replace a current workflow.',
    });
    await expect(workflows.generateFullWorkflow(project.id)).rejects.toThrow(
      'Use safe regeneration to replace a current workflow.',
    );
  });

  it('regenerates a changed stage suffix atomically and snapshots the workflow it replaces', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'A changed reusable prompt must refresh one coherent product workflow.',
    });
    let briefVersion = 0;
    let screenVersion = 0;
    let prdVersion = 0;
    const calls: string[] = [];
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          briefVersion += 1;
          calls.push(`design_brief_${briefVersion}`);
          return {
            markdown: `# Design Brief ${briefVersion}\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`,
            responseId: `resp_brief_${briefVersion}`,
            requestId: `req_brief_${briefVersion}`,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          prdVersion += 1;
          calls.push(`prd_${prdVersion}`);
          return {
            markdown: `# PRD ${prdVersion}\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`,
            responseId: `resp_prd_${prdVersion}`,
            requestId: `req_prd_${prdVersion}`,
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          if (input.ordinal === 1) screenVersion += 1;
          calls.push(`concept_screen_${screenVersion}_${input.ordinal}`);
          return {
            png: pngFixture(screenVersion * 30 + input.ordinal),
            requestId: `req_screen_${screenVersion}_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await completeFullWorkflow(workflows, project.id);
    const original = workflows.promoteFullWorkflow(project.id);
    const originalArtifactIds = {
      designBrief: original.designBrief!.id,
      conceptScreens: original.conceptScreenSet!.id,
      prd: original.prd!.id,
    };

    const configuration = await openWorkflowConfigurationService(dataDirectory, {
      now: () => new Date('2026-07-17T12:00:00.000Z'),
    });
    const currentConfiguration = configuration.getWorkflowConfiguration()
      .stages.find(({ id }) => id === 'design_brief')!;
    configuration.commitStageConfiguration('design_brief', {
      prompt: `${currentConfiguration.prompt}\nPrioritize explicit trade-offs.`,
      model: 'gpt-5.4-mini',
      imageQuality: null,
    });
    const currentPrdConfiguration = configuration.getWorkflowConfiguration()
      .stages.find(({ id }) => id === 'prd')!;
    configuration.commitStageConfiguration('prd', {
      prompt: `${currentPrdConfiguration.prompt}\nCall out unresolved product risks.`,
      model: currentPrdConfiguration.model,
      imageQuality: null,
    });
    configuration.close();

    const update = workflows.getProjectWorkflow(project.id);
    expect(projects.listProjects()[0]?.updateAvailable).toBe(true);
    expect(update.rerunPlan).toMatchObject({
      earliestChangedStage: 'design_brief',
      affectedStages: ['design_brief', 'concept_screens', 'prd'],
      changes: [
        { stageId: 'design_brief', kind: 'prompt' },
        { stageId: 'design_brief', kind: 'model' },
        { stageId: 'prd', kind: 'prompt' },
      ],
    });
    expect(update.rerunPlan?.fingerprints.map(({ stageId }) => stageId)).toEqual([
      'design_brief',
      'prd',
    ]);
    const designBriefFingerprints = update.rerunPlan?.fingerprints[0];
    expect(designBriefFingerprints?.previous.combined).not.toBe(
      designBriefFingerprints?.current.combined,
    );
    expect(designBriefFingerprints?.previous.input).toBe(
      designBriefFingerprints?.current.input,
    );
    expect(designBriefFingerprints?.previous.prompt).not.toBe(
      designBriefFingerprints?.current.prompt,
    );
    expect(designBriefFingerprints?.previous.model).not.toBe(
      designBriefFingerprints?.current.model,
    );
    await expect(workflows.regenerateWorkflow(project.id, 'prd')).rejects.toThrow(
      'Regenerate from Design Brief to begin at the earliest changed stage.',
    );

    const afterBrief = await workflows.regenerateWorkflow(project.id, 'design_brief');
    expect(afterBrief).toMatchObject({
      designBrief: { id: originalArtifactIds.designBrief },
      conceptScreenSet: { id: originalArtifactIds.conceptScreens },
      prd: { id: originalArtifactIds.prd },
      candidate: { status: 'paused', currentStage: 'concept_screens' },
    });
    let candidate = afterBrief;
    while (candidate.candidate?.status === 'paused') {
      candidate = await workflows.resumeFullWorkflow(project.id);
    }
    const regenerated = workflows.promoteFullWorkflow(project.id);

    expect(calls).toEqual([
      'design_brief_1',
      'concept_screen_1_1',
      'concept_screen_1_2',
      'concept_screen_1_3',
      'prd_1',
      'design_brief_2',
      'concept_screen_2_1',
      'concept_screen_2_2',
      'concept_screen_2_3',
      'prd_2',
    ]);
    expect(regenerated.designBrief?.id).not.toBe(originalArtifactIds.designBrief);
    expect(regenerated.conceptScreenSet?.id).not.toBe(originalArtifactIds.conceptScreens);
    expect(regenerated.prd?.id).not.toBe(originalArtifactIds.prd);
    expect(regenerated.snapshots).toEqual([
      expect.objectContaining({
        replacedFromStage: 'design_brief',
        artifactIds: originalArtifactIds,
      }),
    ]);
    expect(regenerated.rerunPlan).toBeNull();
    expect(projects.listProjects()[0]?.updateAvailable).toBe(false);
  });

  it('inspects a Workflow Snapshot with its read-only Artifacts and Stage Run provenance', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'Snapshot history should keep coherent product work inspectable.',
    });
    let version = 0;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          version += 1;
          return {
            markdown: `# Design Brief ${version}\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`,
            responseId: `resp_brief_${version}`,
            requestId: `req_brief_${version}`,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          return {
            markdown: `# PRD ${version}\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`,
            responseId: `resp_prd_${version}`,
            requestId: `req_prd_${version}`,
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          return {
            png: pngFixture(version * 30 + input.ordinal),
            requestId: `req_screen_${version}_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await completeFullWorkflow(workflows, project.id);
    const original = workflows.promoteFullWorkflow(project.id);
    let candidate = await workflows.regenerateWorkflow(project.id, 'design_brief');
    while (candidate.candidate?.status === 'paused') {
      candidate = await workflows.resumeFullWorkflow(project.id);
    }
    const regenerated = workflows.promoteFullWorkflow(project.id);
    const summary = regenerated.snapshots[0]!;

    expect(summary).toMatchObject({
      preservedBy: 'promotion',
      replacedFromStage: 'design_brief',
      artifactIds: {
        designBrief: original.designBrief?.id,
        conceptScreens: original.conceptScreenSet?.id,
        prd: original.prd?.id,
      },
      stages: [
        { stageId: 'design_brief', runKind: 'initial', model: expect.any(String) },
        { stageId: 'concept_screens', runKind: 'initial', model: expect.any(String) },
        { stageId: 'prd', runKind: 'initial', model: expect.any(String) },
      ],
    });
    expect(workflows.getWorkflowSnapshot(project.id, summary.id)).toMatchObject({
      ...summary,
      designBrief: original.designBrief,
      designBriefRun: original.lastDesignBriefRun,
      conceptScreenSet: original.conceptScreenSet,
      conceptScreenRun: original.lastConceptScreenRun,
      prd: original.prd,
      prdRun: original.lastPrdRun,
    });

    const globalConfiguration = await openWorkflowConfigurationService(dataDirectory);
    const currentDesignBriefConfiguration = globalConfiguration
      .getWorkflowConfiguration().stages.find(({ id }) => id === 'design_brief')!;
    globalConfiguration.commitStageConfiguration('design_brief', {
      prompt: `${currentDesignBriefConfiguration.prompt}\nKeep this global improvement.`,
      model: currentDesignBriefConfiguration.model,
      imageQuality: null,
    });
    const configuredPrompt = globalConfiguration.getWorkflowConfiguration()
      .stages.find(({ id }) => id === 'design_brief')!.prompt;
    globalConfiguration.close();

    const restored = workflows.restoreWorkflowSnapshot(project.id, summary.id);

    expect(restored).toMatchObject({
      designBrief: { markdown: original.designBrief?.markdown },
      conceptScreenSet: { screens: original.conceptScreenSet?.screens },
      prd: { markdown: original.prd?.markdown },
      snapshots: [
        {
          preservedBy: 'restoration',
          replacedFromStage: 'design_brief',
          artifactIds: {
            designBrief: regenerated.designBrief?.id,
            conceptScreens: regenerated.conceptScreenSet?.id,
            prd: regenerated.prd?.id,
          },
        },
        expect.objectContaining({ id: summary.id }),
      ],
    });
    expect(restored.designBrief?.id).not.toBe(original.designBrief?.id);
    expect(restored.conceptScreenSet?.id).not.toBe(original.conceptScreenSet?.id);
    expect(restored.prd?.id).not.toBe(original.prd?.id);
    expect(restored.designBrief?.runId).toBe(original.designBrief?.runId);
    expect(restored.conceptScreenSet?.runId).toBe(original.conceptScreenSet?.runId);
    expect(restored.prd?.runId).toBe(original.prd?.runId);
    expect(workflows.getWorkflowSnapshot(project.id, summary.id).id).toBe(summary.id);
    const unchangedConfiguration = await openWorkflowConfigurationService(dataDirectory);
    expect(unchangedConfiguration.getWorkflowConfiguration()
      .stages.find(({ id }) => id === 'design_brief')!.prompt)
      .toBe(configuredPrompt);
    unchangedConfiguration.close();

    const restoredAssetId = original.conceptScreenSet!.screens[0]!.assetId;
    const replacedAssetId = regenerated.conceptScreenSet!.screens[0]!.assetId;
    const replacedAssetBytes = workflows.getConceptScreenAsset(project.id, replacedAssetId);
    const restorationSnapshotId = restored.snapshots[0]!.id;
    const afterSelectedDeletion = await workflows.deleteWorkflowSnapshot(
      project.id,
      summary.id,
    );
    expect(afterSelectedDeletion.snapshots.map(({ id }) => id))
      .toEqual([restorationSnapshotId]);
    expect(workflows.getConceptScreenAsset(project.id, restoredAssetId))
      .toEqual(pngFixture(31));

    const replacedAssetPath = join(dataDirectory, 'assets', `${replacedAssetId}.png`);
    await rm(replacedAssetPath);
    await mkdir(replacedAssetPath);
    await writeFile(join(replacedAssetPath, 'blocker'), 'prevent file reclamation');
    await expect(workflows.deleteWorkflowSnapshot(project.id, restorationSnapshotId))
      .rejects.toThrow();
    expect(workflows.getProjectWorkflow(project.id).snapshots.map(({ id }) => id))
      .toEqual([restorationSnapshotId]);
    await rm(replacedAssetPath, { recursive: true });
    await writeFile(replacedAssetPath, replacedAssetBytes);

    const afterReplacedDeletion = await workflows.deleteWorkflowSnapshot(
      project.id,
      restorationSnapshotId,
    );
    expect(afterReplacedDeletion.snapshots).toEqual([]);
    expect(() => workflows.getConceptScreenAsset(project.id, replacedAssetId))
      .toThrow(replacedAssetId);
  });

  it('regenerates from Concept Screens when its prompt or image settings change', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'Image configuration changes should preserve the authoritative Design Brief.',
    });
    const calls: string[] = [];
    let cycle = 1;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          calls.push('design_brief');
          return {
            markdown: `# Design Brief\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`,
            responseId: 'resp_brief',
            requestId: 'req_brief',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          calls.push(`prd_${cycle}`);
          return {
            markdown: `# PRD ${cycle}\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`,
            responseId: `resp_prd_${cycle}`,
            requestId: `req_prd_${cycle}`,
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          calls.push(`concept_screen_${cycle}_${input.ordinal}`);
          return {
            png: pngFixture(cycle * 30 + input.ordinal),
            requestId: `req_screen_${cycle}_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await completeFullWorkflow(workflows, project.id);
    const original = workflows.promoteFullWorkflow(project.id);

    const configuration = await openWorkflowConfigurationService(dataDirectory, {
      now: () => new Date('2026-07-17T12:10:00.000Z'),
    });
    const currentConfiguration = configuration.getWorkflowConfiguration()
      .stages.find(({ id }) => id === 'concept_screens')!;
    configuration.commitStageConfiguration('concept_screens', {
      prompt: `${currentConfiguration.prompt}\nEmphasize the shared navigation.`,
      model: currentConfiguration.model,
      imageQuality: currentConfiguration.imageQuality === 'high' ? 'medium' : 'high',
    });
    configuration.close();

    const update = workflows.getProjectWorkflow(project.id);
    expect(update.rerunPlan).toMatchObject({
      earliestChangedStage: 'concept_screens',
      affectedStages: ['concept_screens', 'prd'],
      changes: [
        { stageId: 'concept_screens', kind: 'prompt' },
        { stageId: 'concept_screens', kind: 'settings' },
      ],
    });
    await expect(workflows.regenerateWorkflow(project.id, 'design_brief')).rejects.toThrow(
      'Regenerate from Concept Screens to begin at the earliest changed stage.',
    );

    cycle = 2;
    let candidate = await workflows.regenerateWorkflow(project.id, 'concept_screens');
    while (candidate.candidate?.status === 'paused') {
      candidate = await workflows.resumeFullWorkflow(project.id);
    }
    const regenerated = workflows.promoteFullWorkflow(project.id);

    expect(calls).toEqual([
      'design_brief',
      'concept_screen_1_1',
      'concept_screen_1_2',
      'concept_screen_1_3',
      'prd_1',
      'concept_screen_2_1',
      'concept_screen_2_2',
      'concept_screen_2_3',
      'prd_2',
    ]);
    expect(regenerated.designBrief?.id).toBe(original.designBrief?.id);
    expect(regenerated.conceptScreenSet?.id).not.toBe(original.conceptScreenSet?.id);
    expect(regenerated.prd?.id).not.toBe(original.prd?.id);
    expect(regenerated.snapshots[0]).toMatchObject({
      replacedFromStage: 'concept_screens',
      artifactIds: {
        designBrief: original.designBrief?.id,
        conceptScreens: original.conceptScreenSet?.id,
        prd: original.prd?.id,
      },
    });
  });

  it('labels an explicitly chosen identical-input suffix as a Variation Run', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'An Author should be able to sample another PRD without pretending inputs changed.',
    });
    const calls: string[] = [];
    let prdVersion = 0;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          calls.push('design_brief');
          return {
            markdown: `# Design Brief\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`,
            responseId: 'resp_brief',
            requestId: 'req_brief',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          prdVersion += 1;
          calls.push(`prd_${prdVersion}`);
          return {
            markdown: `# PRD variation ${prdVersion}\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`,
            responseId: `resp_prd_${prdVersion}`,
            requestId: `req_prd_${prdVersion}`,
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          calls.push(`concept_screen_${input.ordinal}`);
          return {
            png: pngFixture(40 + input.ordinal),
            requestId: `req_screen_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await completeFullWorkflow(workflows, project.id);
    const original = workflows.promoteFullWorkflow(project.id);
    expect(original.rerunPlan).toBeNull();
    await expect(workflows.generatePrd(project.id)).rejects.toThrow(
      'Use a Candidate Workflow to replace the current PRD safely.',
    );

    const candidate = await workflows.regenerateWorkflow(project.id, 'prd');
    expect(candidate).toMatchObject({
      designBrief: { id: original.designBrief?.id },
      conceptScreenSet: { id: original.conceptScreenSet?.id },
      prd: { id: original.prd?.id },
      candidate: {
        runKind: 'variation',
        status: 'awaiting_promotion',
        completedOperationCount: 5,
      },
    });
    const varied = workflows.promoteFullWorkflow(project.id);

    expect(calls).toEqual([
      'design_brief',
      'concept_screen_1',
      'concept_screen_2',
      'concept_screen_3',
      'prd_1',
      'prd_2',
    ]);
    expect(varied.designBrief?.id).toBe(original.designBrief?.id);
    expect(varied.conceptScreenSet?.id).toBe(original.conceptScreenSet?.id);
    expect(varied.prd?.id).not.toBe(original.prd?.id);
    expect(varied.lastPrdRun?.runKind).toBe('variation');
    expect(varied.snapshots[0]?.replacedFromStage).toBe('prd');
  });

  it('labels only the unchanged-input stage as variation within a cascaded Variation Run', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'A variation can create new downstream inputs even when its starting input is unchanged.',
    });
    let briefVersion = 0;
    let prdVersion = 0;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          briefVersion += 1;
          return {
            markdown: `# Design Brief ${briefVersion}\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`,
            responseId: `resp_brief_${briefVersion}`,
            requestId: `req_brief_${briefVersion}`,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          prdVersion += 1;
          return {
            markdown: `# PRD ${prdVersion}\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`,
            responseId: `resp_prd_${prdVersion}`,
            requestId: `req_prd_${prdVersion}`,
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          return {
            png: pngFixture(briefVersion * 30 + input.ordinal),
            requestId: `req_screen_${briefVersion}_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await completeFullWorkflow(workflows, project.id);
    workflows.promoteFullWorkflow(project.id);

    let candidate = await workflows.regenerateWorkflow(project.id, 'design_brief');
    while (candidate.candidate?.status === 'paused') {
      candidate = await workflows.resumeFullWorkflow(project.id);
    }
    const varied = workflows.promoteFullWorkflow(project.id);

    expect(varied.lastDesignBriefRun?.runKind).toBe('variation');
    expect(varied.lastConceptScreenRun?.runKind).toBe('regeneration');
    expect(varied.lastPrdRun?.runKind).toBe('regeneration');
  });

  it('persists an Insight Revision without changing the current Project or workflow', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const originalInsight = 'Busy renters need a calmer way to compare neighbourhood trade-offs.';
    const revisedInsight = 'Busy renters need a calmer way to compare neighbourhoods and commute options.';
    const project = projects.createProject({ insightSource: originalInsight });
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          return {
            markdown: `# Design Brief\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`,
            responseId: 'resp_revision_brief',
            requestId: 'req_revision_brief',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          return {
            markdown: `# PRD\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`,
            responseId: 'resp_revision_prd',
            requestId: 'req_revision_prd',
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          return {
            png: pngFixture(input.ordinal * 35),
            requestId: `req_revision_screen_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await completeFullWorkflow(workflows, project.id);
    const current = workflows.promoteFullWorkflow(project.id);

    const started = workflows.beginInsightRevision(project.id);
    expect(started.insightRevision).toMatchObject({ insightSource: originalInsight });

    const edited = workflows.updateInsightRevision(project.id, revisedInsight);
    expect(edited).toMatchObject({
      insightRevision: { insightSource: revisedInsight },
      designBrief: { id: current.designBrief?.id },
      conceptScreenSet: { id: current.conceptScreenSet?.id },
      prd: { id: current.prd?.id },
      candidate: null,
    });
    expect(projects.getProject(project.id)?.insightSource).toBe(originalInsight);

    workflows.close();
    workflowServices.splice(workflowServices.indexOf(workflows), 1);
    const reopened = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          throw new Error('Generation was not expected while reopening a revision.');
        },
        async generatePrd() {
          throw new Error('Generation was not expected while reopening a revision.');
        },
      },
    });
    workflowServices.push(reopened);
    expect(reopened.getProjectWorkflow(project.id).insightRevision).toMatchObject({
      insightSource: revisedInsight,
    });

    const discarded = reopened.discardInsightRevision(project.id);
    expect(discarded.insightRevision).toBeNull();
    expect(projects.getProject(project.id)?.insightSource).toBe(originalInsight);
  });

  it('snapshots a partial current workflow when an Insight Revision is promoted', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const originalInsight = 'Renters need a clear way to compare neighbourhood trade-offs.';
    const revisedInsight = 'Renters need to compare neighbourhoods, commutes, and accessibility.';
    const project = projects.createProject({ insightSource: originalInsight });
    let blockConceptGeneration = false;
    let signalConceptStarted: () => void = () => {};
    const conceptStarted = new Promise<void>((resolve) => {
      signalConceptStarted = resolve;
    });
    let releaseConceptGeneration: () => void = () => {};
    const conceptRelease = new Promise<void>((resolve) => {
      releaseConceptGeneration = resolve;
    });
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief(input) {
          return {
            markdown: `# Design Brief\n\n${input.insightSource}\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`,
            responseId: 'resp_partial_revision_brief',
            requestId: 'req_partial_revision_brief',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          return {
            markdown: `# PRD\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`,
            responseId: 'resp_partial_revision_prd',
            requestId: 'req_partial_revision_prd',
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          if (blockConceptGeneration && input.ordinal === 1) {
            signalConceptStarted();
            await conceptRelease;
          }
          return {
            png: pngFixture(input.ordinal * 45),
            requestId: `req_partial_revision_screen_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);

    const partial = await workflows.generateDesignBrief(project.id);
    workflows.beginInsightRevision(project.id);
    workflows.updateInsightRevision(project.id, revisedInsight);
    let candidate = await workflows.generateCandidateFromInsightRevision(project.id);
    while (candidate.candidate?.status === 'paused') {
      candidate = await workflows.resumeFullWorkflow(project.id);
    }

    const promoted = workflows.promoteFullWorkflow(project.id);

    expect(projects.getProject(project.id)?.insightSource).toBe(revisedInsight);
    expect(promoted.snapshots).toEqual([expect.objectContaining({
      replacedFromStage: 'design_brief',
      insightSource: originalInsight,
      artifactIds: {
        designBrief: partial.designBrief?.id,
        conceptScreens: null,
        prd: null,
      },
    })]);

    const partialSnapshotId = promoted.snapshots[0]!.id;
    const restoredPartial = workflows.restoreWorkflowSnapshot(project.id, partialSnapshotId);
    const completeSnapshotId = restoredPartial.snapshots[0]!.id;
    blockConceptGeneration = true;
    const guidedGeneration = workflows.generateConceptScreens(project.id);
    await conceptStarted;

    expect(() => workflows.restoreWorkflowSnapshot(project.id, completeSnapshotId))
      .toThrow('Generation is already running for this Project.');

    releaseConceptGeneration();
    await guidedGeneration;
  });

  it('resumes a Candidate Workflow for an Insight Revision and promotes atomically', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const originalInsight = 'Renters need a trustworthy way to compare neighbourhood trade-offs.';
    const revisedInsight = 'Renters need to compare neighbourhoods, commutes, and accessibility needs.';
    const project = projects.createProject({ insightSource: originalInsight });
    let briefVersion = 0;
    let prdVersion = 0;
    let failRevision = false;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief(input) {
          if (input.insightSource === revisedInsight && failRevision) {
            throw new GenerationBoundaryError(
              'openai_request_failed',
              'The revised Design Brief failed once.',
            );
          }
          briefVersion += 1;
          return {
            markdown: `# Design Brief ${briefVersion}\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`,
            responseId: `resp_revision_brief_${briefVersion}`,
            requestId: `req_revision_brief_${briefVersion}`,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          prdVersion += 1;
          return {
            markdown: `# PRD ${prdVersion}\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`,
            responseId: `resp_revision_prd_${prdVersion}`,
            requestId: `req_revision_prd_${prdVersion}`,
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          return {
            png: pngFixture(briefVersion * 30 + input.ordinal),
            requestId: `req_revision_screen_${briefVersion}_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await completeFullWorkflow(workflows, project.id);
    const original = workflows.promoteFullWorkflow(project.id);
    workflows.beginInsightRevision(project.id);
    workflows.updateInsightRevision(project.id, revisedInsight);

    failRevision = true;
    await expect(workflows.generateCandidateFromInsightRevision(project.id)).rejects.toMatchObject({
      code: 'openai_request_failed',
    });
    expect(workflows.getProjectWorkflow(project.id)).toMatchObject({
      insightRevision: { insightSource: revisedInsight },
      designBrief: { id: original.designBrief?.id },
      conceptScreenSet: { id: original.conceptScreenSet?.id },
      prd: { id: original.prd?.id },
      candidate: {
        runKind: 'regeneration',
        status: 'failed',
        currentStage: 'design_brief',
        completedOperationCount: 0,
      },
    });
    expect(projects.getProject(project.id)?.insightSource).toBe(originalInsight);

    failRevision = false;
    let candidate = await workflows.resumeFullWorkflow(project.id);
    while (candidate.candidate?.status === 'paused') {
      candidate = await workflows.resumeFullWorkflow(project.id);
    }
    expect(candidate).toMatchObject({
      insightRevision: { insightSource: revisedInsight },
      designBrief: { id: original.designBrief?.id },
      conceptScreenSet: { id: original.conceptScreenSet?.id },
      prd: { id: original.prd?.id },
      candidate: { status: 'awaiting_promotion' },
    });

    const promoted = workflows.promoteFullWorkflow(project.id);
    expect(projects.getProject(project.id)?.insightSource).toBe(revisedInsight);
    expect(promoted).toMatchObject({
      insightRevision: null,
      candidate: null,
      snapshots: [{
        replacedFromStage: 'design_brief',
        insightSource: originalInsight,
        artifactIds: {
          designBrief: original.designBrief?.id,
          conceptScreens: original.conceptScreenSet?.id,
          prd: original.prd?.id,
        },
      }],
    });
    expect(promoted.designBrief?.id).not.toBe(original.designBrief?.id);
    expect(promoted.conceptScreenSet?.id).not.toBe(original.conceptScreenSet?.id);
    expect(promoted.prd?.id).not.toBe(original.prd?.id);
  });

  it('discards an incomplete Candidate Workflow for an Insight Revision safely', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const originalInsight = 'Authors need a stable workflow while revisions are incomplete.';
    const revisedInsight = 'Authors need an explicitly discardable revision candidate.';
    const project = projects.createProject({ insightSource: originalInsight });
    let rejectRevision = false;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief(input) {
          if (rejectRevision && input.insightSource === revisedInsight) {
            throw new GenerationBoundaryError(
              'openai_request_failed',
              'The revised workflow is incomplete.',
            );
          }
          return {
            markdown: `# Design Brief\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`,
            responseId: 'resp_discard_revision_brief',
            requestId: 'req_discard_revision_brief',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          return {
            markdown: `# PRD\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`,
            responseId: 'resp_discard_revision_prd',
            requestId: 'req_discard_revision_prd',
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          return {
            png: pngFixture(input.ordinal * 40),
            requestId: `req_discard_revision_screen_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await completeFullWorkflow(workflows, project.id);
    const original = workflows.promoteFullWorkflow(project.id);
    workflows.beginInsightRevision(project.id);
    workflows.updateInsightRevision(project.id, revisedInsight);
    rejectRevision = true;
    await expect(workflows.generateCandidateFromInsightRevision(project.id)).rejects.toMatchObject({
      code: 'openai_request_failed',
    });

    const discarded = await workflows.discardFullWorkflow(project.id);

    expect(projects.getProject(project.id)?.insightSource).toBe(originalInsight);
    expect(discarded).toMatchObject({
      insightRevision: null,
      candidate: null,
      designBrief: { id: original.designBrief?.id },
      conceptScreenSet: { id: original.conceptScreenSet?.id },
      prd: { id: original.prd?.id },
    });
  });

  it('resumes a failed Candidate Workflow at the failed operation without automatic retry', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'A recoverable full workflow should preserve every successful candidate operation.',
    });
    const calls: string[] = [];
    let prdAttempts = 0;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          calls.push('design_brief');
          return {
            markdown: `# Design Brief\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`,
            responseId: 'resp_resume_brief',
            requestId: 'req_resume_brief',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          calls.push('prd');
          prdAttempts += 1;
          if (prdAttempts === 1) {
            throw new GenerationBoundaryError(
              'openai_request_failed',
              'The PRD request failed once.',
              { requestId: 'req_full_prd_failed' },
            );
          }
          return {
            markdown: `# PRD\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`,
            responseId: 'resp_resumed_prd',
            requestId: 'req_resumed_prd',
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          calls.push(`concept_screen_${input.ordinal}`);
          return {
            png: pngFixture(input.ordinal * 30),
            requestId: `req_resume_screen_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);

    await expect(completeFullWorkflow(workflows, project.id)).rejects.toMatchObject({
      code: 'openai_request_failed',
    });
    expect(workflows.getProjectWorkflow(project.id)).toMatchObject({
      designBrief: null,
      conceptScreenSet: null,
      prd: null,
      candidate: {
        status: 'failed',
        currentStage: 'prd',
        completedOperationCount: 4,
        error: { code: 'openai_request_failed' },
      },
    });
    expect(calls).toEqual([
      'design_brief',
      'concept_screen_1',
      'concept_screen_2',
      'concept_screen_3',
      'prd',
    ]);

    const resumedCandidate = await workflows.resumeFullWorkflow(project.id);
    expect(resumedCandidate.candidate).toMatchObject({ status: 'awaiting_promotion' });
    const resumed = workflows.promoteFullWorkflow(project.id);

    expect(calls).toEqual([
      'design_brief',
      'concept_screen_1',
      'concept_screen_2',
      'concept_screen_3',
      'prd',
      'prd',
    ]);
    expect(resumed).toMatchObject({
      designBrief: { stageId: 'design_brief' },
      conceptScreenSet: { stageId: 'concept_screens' },
      prd: { stageId: 'prd' },
      candidate: null,
    });
  });

  it('summarizes Candidate Workflow warnings before explicit promotion', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'A thin mock candidate should require warning review before promotion.',
    });
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          return {
            markdown: '# Design Brief\n\nA concise direction.',
            responseId: 'resp_warning_brief',
            requestId: 'req_warning_brief',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
        async generatePrd() {
          return {
            markdown: '# PRD\n\nA concise requirement.',
            responseId: 'resp_warning_prd',
            requestId: 'req_warning_prd',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          return {
            png: pngFixture(input.ordinal * 35),
            requestId: `req_warning_screen_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);

    const awaitingReview = await completeFullWorkflow(workflows, project.id);

    expect(awaitingReview).toMatchObject({
      designBrief: null,
      conceptScreenSet: null,
      prd: null,
      candidate: {
        status: 'awaiting_warning_review',
        currentStage: 'promotion',
        completedOperationCount: 5,
        warnings: [
          { stageId: 'design_brief', code: 'below_recommended_word_count' },
          { stageId: 'prd', code: 'below_recommended_word_count' },
        ],
      },
    });

    const kept = workflows.keepCandidateAfterWarningReview(project.id);
    expect(kept).toMatchObject({
      designBrief: null,
      conceptScreenSet: null,
      prd: null,
      candidate: {
        status: 'kept_after_warning_review',
        warnings: [
          { stageId: 'design_brief', code: 'below_recommended_word_count' },
          { stageId: 'prd', code: 'below_recommended_word_count' },
        ],
      },
    });

    const promoted = workflows.promoteFullWorkflow(project.id);

    expect(promoted).toMatchObject({
      designBrief: { stageId: 'design_brief' },
      conceptScreenSet: { stageId: 'concept_screens' },
      prd: { stageId: 'prd' },
      candidate: null,
    });
  });

  it('cancels Full Generation between operations and resumes the preserved candidate', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'Cancellation should stop before the next expensive operation.',
    });
    const calls: string[] = [];
    let firstScreenStarted!: () => void;
    let releaseFirstScreen!: () => void;
    const waitForFirstScreen = new Promise<void>((resolve) => { firstScreenStarted = resolve; });
    const holdFirstScreen = new Promise<void>((resolve) => { releaseFirstScreen = resolve; });
    let hold = true;
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          calls.push('design_brief');
          return {
            markdown: `# Design Brief\n\n${'Evidence direction outcome constraint assumption. '.repeat(55)}`,
            responseId: 'resp_cancel_full_brief',
            requestId: 'req_cancel_full_brief',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          calls.push('prd');
          return {
            markdown: `# PRD\n\n${'Requirement rationale acceptance measure dependency. '.repeat(55)}`,
            responseId: 'resp_cancel_full_prd',
            requestId: 'req_cancel_full_prd',
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          calls.push(`concept_screen_${input.ordinal}`);
          if (input.ordinal === 1 && hold) {
            firstScreenStarted();
            await holdFirstScreen;
          }
          return {
            png: pngFixture(input.ordinal * 45),
            requestId: `req_cancel_full_screen_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          };
        },
      },
    });
    workflowServices.push(workflows);

    const afterDesignBrief = await workflows.generateFullWorkflow(project.id);
    expect(afterDesignBrief.candidate).toMatchObject({ status: 'paused' });
    const generation = workflows.resumeFullWorkflow(project.id);
    await waitForFirstScreen;
    expect(workflows.cancelFullWorkflow(project.id)).toBe(true);
    releaseFirstScreen();
    await expect(generation).rejects.toMatchObject({ code: 'cancelled' });

    expect(workflows.getProjectWorkflow(project.id)).toMatchObject({
      designBrief: null,
      conceptScreenSet: null,
      prd: null,
      candidate: {
        status: 'cancelled',
        currentStage: 'concept_screens',
        completedOperationCount: 2,
      },
    });
    expect(calls).toEqual(['design_brief', 'concept_screen_1']);

    hold = false;
    const afterConceptScreens = await workflows.resumeFullWorkflow(project.id);
    expect(afterConceptScreens.candidate).toMatchObject({
      status: 'paused',
      currentStage: 'prd',
    });
    const resumedCandidate = await workflows.resumeFullWorkflow(project.id);
    expect(resumedCandidate.candidate).toMatchObject({ status: 'awaiting_promotion' });
    const resumed = workflows.promoteFullWorkflow(project.id);

    expect(calls).toEqual([
      'design_brief',
      'concept_screen_1',
      'concept_screen_2',
      'concept_screen_3',
      'prd',
    ]);
    expect(resumed.candidate).toBeNull();
    expect(resumed.prd).not.toBeNull();
  });

  it('discards a failed Candidate Workflow explicitly', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const project = projects.createProject({
      insightSource: 'A failed candidate can be abandoned without changing the current workflow.',
    });
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        ...prdNotExpected(),
        async generateDesignBrief() {
          throw new GenerationBoundaryError(
            'openai_request_failed',
            'The candidate Design Brief failed.',
          );
        },
      },
    });
    workflowServices.push(workflows);
    await expect(workflows.generateFullWorkflow(project.id)).rejects.toMatchObject({
      code: 'openai_request_failed',
    });

    const discarded = await workflows.discardFullWorkflow(project.id);

    expect(discarded).toMatchObject({
      canGenerateFullWorkflow: true,
      candidate: null,
      designBrief: null,
      conceptScreenSet: null,
      prd: null,
      lastDesignBriefRun: null,
    });
  });

  it('exports only the current deliverables with readable names and complete provenance', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory, {
      now: () => new Date('2026-07-17T08:00:00.000Z'),
    });
    projectServices.push(projects);
    const project = projects.createProject({
      name: 'Retrofit Decisions',
      insightSource: 'Homeowners need a defensible way to compare retrofit proposals.',
    });
    const configuration = await openWorkflowConfigurationService(dataDirectory, {
      now: () => new Date('2026-07-17T08:01:00.000Z'),
    });
    configuration.commitStageConfiguration('design_brief', {
      prompt: 'Explain the product opportunity.',
      model: 'gpt-5.4-mini',
      imageQuality: null,
    });
    configuration.commitStageConfiguration('concept_screens', {
      prompt: 'Show the primary journey.',
      model: 'gpt-image-2',
      imageQuality: 'high',
    });
    configuration.commitStageConfiguration('prd', {
      prompt: 'Turn the approved direction into requirements.',
      model: 'gpt-5.4-mini',
      imageQuality: null,
    });
    configuration.close();
    const designBrief = '# Design Brief\n\nA clear comparison journey.';
    const prd = '# PRD\n\nThe Author can compare proposals and record a decision.';
    const pngs = [pngFixture(25), pngFixture(75), pngFixture(125)];
    const workflows = await openWorkflowService(dataDirectory, {
      now: () => new Date('2026-07-17T08:02:00.000Z'),
      textGeneration: {
        async generateDesignBrief() {
          return {
            markdown: designBrief,
            responseId: 'resp_export_brief',
            requestId: 'req_export_brief',
            usage: { inputTokens: 11, outputTokens: 12, totalTokens: 23 },
          };
        },
        async generatePrd() {
          return {
            markdown: prd,
            responseId: 'resp_export_prd',
            requestId: 'req_export_prd',
            usage: { inputTokens: 31, outputTokens: 32, totalTokens: 63 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          return {
            png: pngs[input.ordinal - 1],
            requestId: `req_export_screen_${input.ordinal}`,
            responseId: null,
            usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
          };
        },
      },
    });
    workflowServices.push(workflows);
    await workflows.generateDesignBrief(project.id);
    await workflows.generateConceptScreens(project.id);
    await workflows.generatePrd(project.id);

    const exported = workflows.exportDeliverables(project.id);
    const files = unzipSync(exported.bytes);

    expect(exported.fileName).toBe('retrofit-decisions-deliverables.zip');
    expect(Object.keys(files).sort()).toEqual([
      'concept-screen-1.png',
      'concept-screen-2.png',
      'concept-screen-3.png',
      'design-brief.md',
      'manifest.json',
      'prd.md',
    ]);
    expect(strFromU8(files['design-brief.md'])).toBe(designBrief);
    expect(strFromU8(files['prd.md'])).toBe(prd);
    expect(Buffer.from(files['concept-screen-1.png'])).toEqual(pngs[0]);
    expect(Buffer.from(files['concept-screen-2.png'])).toEqual(pngs[1]);
    expect(Buffer.from(files['concept-screen-3.png'])).toEqual(pngs[2]);
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as {
      project: { id: string; name: string };
      exportedAt: string;
      stages: Array<Record<string, unknown>>;
    };
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      project: { id: project.id, name: 'Retrofit Decisions' },
      exportedAt: '2026-07-17T08:02:00.000Z',
      stages: [
        {
          stageId: 'design_brief',
          stage: 'Design Brief',
          file: 'design-brief.md',
          model: 'gpt-5.4-mini',
          prompt: 'Explain the product opportunity.',
          requestId: 'req_export_brief',
          responseId: 'resp_export_brief',
          usage: { inputTokens: 11, outputTokens: 12, totalTokens: 23 },
        },
        {
          stageId: 'concept_screens',
          stage: 'Concept Screen Set',
          files: [
            'concept-screen-1.png',
            'concept-screen-2.png',
            'concept-screen-3.png',
          ],
          model: 'gpt-image-2',
          prompt: 'Show the primary journey.',
          imageQuality: 'high',
          operations: [
            { ordinal: 1, requestId: 'req_export_screen_1' },
            { ordinal: 2, requestId: 'req_export_screen_2' },
            { ordinal: 3, requestId: 'req_export_screen_3' },
          ],
        },
        {
          stageId: 'prd',
          stage: 'PRD',
          file: 'prd.md',
          model: 'gpt-5.4-mini',
          prompt: 'Turn the approved direction into requirements.',
          requestId: 'req_export_prd',
          responseId: 'resp_export_prd',
          usage: { inputTokens: 31, outputTokens: 32, totalTokens: 63 },
        },
      ],
    });
    expect(strFromU8(files['manifest.json'])).not.toContain(project.insightSource);
    expect(strFromU8(files['manifest.json'])).not.toContain('apiKey');
    expect(strFromU8(files['manifest.json'])).not.toContain('insightforge.sqlite');
  });

  it('exports a complete versioned Project Export with integrity metadata', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory, {
      now: () => new Date('2026-07-17T09:00:00.000Z'),
    });
    projectServices.push(projects);
    const project = projects.createProject({
      name: 'Portable Retrofit Project',
      insightSource: 'Homeowners need a portable record of retrofit decisions.',
    });
    const pngs = [pngFixture(35), pngFixture(85), pngFixture(135)];
    const workflows = await openWorkflowService(dataDirectory, {
      now: () => new Date('2026-07-17T09:05:00.000Z'),
      textGeneration: {
        async generateDesignBrief() {
          return {
            markdown: '# Design Brief\n\nA portable comparison workflow.',
            responseId: 'resp_project_export_brief',
            requestId: 'req_project_export_brief',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
        async generatePrd() {
          return {
            markdown: '# PRD\n\nThe Author can preserve a complete decision record.',
            responseId: 'resp_project_export_prd',
            requestId: 'req_project_export_prd',
            usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
          };
        },
      },
      imageGeneration: {
        async generateConceptScreen(input) {
          return {
            png: pngs[input.ordinal - 1],
            responseId: `resp_project_export_screen_${input.ordinal}`,
            requestId: `req_project_export_screen_${input.ordinal}`,
            usage: { inputTokens: 50, outputTokens: 60, totalTokens: 110 },
          };
        },
      },
    });
    workflowServices.push(workflows);

    await workflows.generateDesignBrief(project.id);
    await workflows.generateConceptScreens(project.id);
    await workflows.generatePrd(project.id);
    let replacement = await workflows.regenerateWorkflow(project.id, 'design_brief');
    while (replacement.candidate?.status === 'paused') {
      replacement = await workflows.resumeFullWorkflow(project.id);
    }
    workflows.promoteFullWorkflow(project.id);
    const resumable = await workflows.regenerateWorkflow(project.id, 'design_brief');
    expect(resumable.candidate).toMatchObject({
      status: 'paused',
      currentStage: 'concept_screens',
    });

    const configuration = await openWorkflowConfigurationService(dataDirectory, {
      now: () => new Date('2026-07-17T09:06:00.000Z'),
    });
    configuration.commitStageConfiguration('prd', {
      prompt: 'GLOBAL_ONLY_DO_NOT_EXPORT',
      model: 'gpt-5.4-mini',
      imageQuality: null,
    });
    configuration.close();

    const exported = workflows.exportProject(project.id);
    const files = unzipSync(exported.bytes);
    const manifestText = strFromU8(files['manifest.json']);
    const projectText = strFromU8(files['project.json']);
    const manifest = JSON.parse(manifestText) as {
      format: string;
      schemaVersion: number;
      application: { name: string; version: string };
      project: { id: string; name: string };
      contents: { project: string; assets: string };
      integrity: {
        algorithm: string;
        files: Array<{ path: string; byteSize: number; sha256: string }>;
      };
    };
    const projectExport = JSON.parse(projectText) as {
      schemaVersion: number;
      project: { id: string; name: string; insightSource: string };
      currentWorkflow: { artifactIds: Record<string, string> };
      workflowSnapshots: Array<{ id: string; artifactIds: Record<string, string> }>;
      candidates: Array<{
        id: string;
        status: string;
        configuration: Record<string, unknown>;
        designBriefArtifactId: string;
      }>;
      artifacts: Array<{ id: string; runId: string; markdown: string }>;
      stageRuns: Array<{ id: string; prompt: string; model: string }>;
      binaryAssets: Array<{
        id: string;
        archivePath: string;
        byteSize: number;
      }>;
    };

    expect(exported.fileName).toBe('portable-retrofit-project-project-export.zip');
    expect(manifest).toMatchObject({
      format: 'insightforge.project-export',
      schemaVersion: 1,
      application: { name: 'InsightForge', version: '0.1.0' },
      project: { id: project.id, name: 'Portable Retrofit Project' },
      contents: { project: 'project.json', assets: 'assets/' },
      integrity: { algorithm: 'sha256' },
    });
    expect(projectExport).toMatchObject({
      schemaVersion: 1,
      project: {
        id: project.id,
        name: 'Portable Retrofit Project',
        insightSource: project.insightSource,
      },
    });
    expect(Object.keys(projectExport.currentWorkflow.artifactIds).sort()).toEqual([
      'conceptScreens',
      'designBrief',
      'prd',
    ]);
    expect(projectExport.workflowSnapshots).toHaveLength(1);
    expect(Object.keys(projectExport.workflowSnapshots[0]!.artifactIds).sort()).toEqual([
      'conceptScreens',
      'designBrief',
      'prd',
    ]);
    expect(projectExport.candidates).toEqual([
      expect.objectContaining({
        id: resumable.candidate!.id,
        status: 'paused',
        designBriefArtifactId: expect.any(String),
        configuration: expect.objectContaining({
          designBrief: expect.objectContaining({ prompt: expect.any(String) }),
        }),
      }),
    ]);
    expect(projectExport.artifacts).toHaveLength(7);
    expect(projectExport.stageRuns).toHaveLength(7);
    expect(projectExport.binaryAssets).toHaveLength(6);

    const payloadPaths = ['project.json', ...projectExport.binaryAssets.map(({ archivePath }) =>
      archivePath)].sort();
    expect(Object.keys(files).sort()).toEqual(['manifest.json', ...payloadPaths].sort());
    expect(manifest.integrity.files.map(({ path }) => path).sort()).toEqual(payloadPaths);
    for (const integrity of manifest.integrity.files) {
      const bytes = files[integrity.path];
      expect(bytes, integrity.path).toBeDefined();
      expect(integrity.byteSize).toBe(bytes!.byteLength);
      expect(integrity.sha256).toBe(
        createHash('sha256').update(bytes!).digest('hex'),
      );
    }

    const archiveText = `${manifestText}\n${projectText}`;
    expect(archiveText).not.toContain('GLOBAL_ONLY_DO_NOT_EXPORT');
    expect(archiveText).not.toContain('OPENAI_API_KEY');
    expect(archiveText).not.toContain('insightforge.sqlite');
    expect(archiveText).not.toContain(dataDirectory);
    expect(projectText).not.toContain('relative_path');

    const incoherentFiles = unzipSync(exported.bytes);
    const incoherentPayload = JSON.parse(strFromU8(incoherentFiles['project.json'])) as {
      currentWorkflow: { artifactIds: { designBrief: string } };
      workflowSnapshots: Array<{ artifactIds: { designBrief: string } }>;
    };
    incoherentPayload.currentWorkflow.artifactIds.designBrief =
      incoherentPayload.workflowSnapshots[0]!.artifactIds.designBrief;
    incoherentFiles['project.json'] = strToU8(`${JSON.stringify(incoherentPayload)}\n`);
    const incoherentManifest = JSON.parse(strFromU8(incoherentFiles['manifest.json'])) as {
      integrity: { files: Array<{ path: string; byteSize: number; sha256: string }> };
    };
    const incoherentProjectIntegrity = incoherentManifest.integrity.files
      .find(({ path }) => path === 'project.json')!;
    incoherentProjectIntegrity.byteSize = incoherentFiles['project.json'].byteLength;
    incoherentProjectIntegrity.sha256 = createHash('sha256')
      .update(incoherentFiles['project.json'])
      .digest('hex');
    incoherentFiles['manifest.json'] = strToU8(`${JSON.stringify(incoherentManifest)}\n`);
    expect(() => workflows.importProject(Buffer.from(zipSync(incoherentFiles))))
      .toThrow('currentWorkflow Concept Screens do not consume its Design Brief');
    expect(projects.listProjects()).toHaveLength(1);

    const brokenCandidateFiles = unzipSync(exported.bytes);
    const brokenCandidatePayload = JSON.parse(
      strFromU8(brokenCandidateFiles['project.json']),
    ) as {
      currentWorkflow: { artifactIds: { prd: string } };
      candidates: Array<{ designBriefArtifactId: string }>;
    };
    brokenCandidatePayload.candidates[0]!.designBriefArtifactId =
      brokenCandidatePayload.currentWorkflow.artifactIds.prd;
    brokenCandidateFiles['project.json'] = strToU8(
      `${JSON.stringify(brokenCandidatePayload)}\n`,
    );
    const brokenCandidateManifest = JSON.parse(
      strFromU8(brokenCandidateFiles['manifest.json']),
    ) as {
      integrity: { files: Array<{ path: string; byteSize: number; sha256: string }> };
    };
    const brokenCandidateIntegrity = brokenCandidateManifest.integrity.files
      .find(({ path }) => path === 'project.json')!;
    brokenCandidateIntegrity.byteSize = brokenCandidateFiles['project.json'].byteLength;
    brokenCandidateIntegrity.sha256 = createHash('sha256')
      .update(brokenCandidateFiles['project.json'])
      .digest('hex');
    brokenCandidateFiles['manifest.json'] = strToU8(
      `${JSON.stringify(brokenCandidateManifest)}\n`,
    );
    expect(() => workflows.importProject(Buffer.from(zipSync(brokenCandidateFiles))))
      .toThrow('Design Brief does not reference a matching Artifact and Stage Run');
    expect(projects.listProjects()).toHaveLength(1);

    const changedCandidateFiles = unzipSync(exported.bytes);
    const changedCandidatePayload = JSON.parse(
      strFromU8(changedCandidateFiles['project.json']),
    ) as { candidates: Array<{ insightSource: string }> };
    changedCandidatePayload.candidates[0]!.insightSource =
      'A different Insight Source introduced after export.';
    changedCandidateFiles['project.json'] = strToU8(
      `${JSON.stringify(changedCandidatePayload)}\n`,
    );
    const changedCandidateManifest = JSON.parse(
      strFromU8(changedCandidateFiles['manifest.json']),
    ) as {
      integrity: { files: Array<{ path: string; byteSize: number; sha256: string }> };
    };
    const changedCandidateIntegrity = changedCandidateManifest.integrity.files
      .find(({ path }) => path === 'project.json')!;
    changedCandidateIntegrity.byteSize = changedCandidateFiles['project.json'].byteLength;
    changedCandidateIntegrity.sha256 = createHash('sha256')
      .update(changedCandidateFiles['project.json'])
      .digest('hex');
    changedCandidateFiles['manifest.json'] = strToU8(
      `${JSON.stringify(changedCandidateManifest)}\n`,
    );
    expect(() => workflows.importProject(Buffer.from(zipSync(changedCandidateFiles))))
      .toThrow('Insight Source does not match its Project');
    expect(projects.listProjects()).toHaveLength(1);

    const sourceWorkflow = workflows.getProjectWorkflow(project.id);
    const imported = workflows.importProject(exported.bytes);
    const importedWorkflow = workflows.getProjectWorkflow(imported.id);
    expect(importedWorkflow).toMatchObject({
      projectId: imported.id,
      designBrief: { markdown: '# Design Brief\n\nA portable comparison workflow.' },
      conceptScreenSet: {
        screens: [
          { ordinal: 1, assetId: expect.any(String) },
          { ordinal: 2, assetId: expect.any(String) },
          { ordinal: 3, assetId: expect.any(String) },
        ],
      },
      prd: { markdown: '# PRD\n\nThe Author can preserve a complete decision record.' },
      candidate: {
        status: 'paused',
        currentStage: 'concept_screens',
      },
      snapshots: [{ preservedBy: 'promotion' }],
      lastDesignBriefRun: {
        model: sourceWorkflow.lastDesignBriefRun!.model,
        stagePrompt: sourceWorkflow.lastDesignBriefRun!.stagePrompt,
        requestId: 'req_project_export_brief',
      },
    });
    expect(importedWorkflow.designBrief?.id).not.toBe(
      sourceWorkflow.designBrief?.id,
    );
    for (const screen of importedWorkflow.conceptScreenSet!.screens) {
      expect(workflows.getConceptScreenAsset(imported.id, screen.assetId))
        .toEqual(pngs[screen.ordinal - 1]);
    }
    const importedSnapshot = workflows.getWorkflowSnapshot(
      imported.id,
      importedWorkflow.snapshots[0]!.id,
    );
    expect(importedSnapshot.conceptScreenSet?.screens).toHaveLength(3);
    const resumedImport = await workflows.resumeFullWorkflow(imported.id);
    expect(resumedImport.candidate).toMatchObject({
      status: 'paused',
      currentStage: 'prd',
    });
    await workflows.discardFullWorkflow(imported.id);
    const restoredImport = workflows.restoreWorkflowSnapshot(
      imported.id,
      importedWorkflow.snapshots[0]!.id,
    );
    expect(restoredImport).toMatchObject({
      designBrief: { markdown: '# Design Brief\n\nA portable comparison workflow.' },
      conceptScreenSet: { screens: [{}, {}, {}] },
      prd: { markdown: '# PRD\n\nThe Author can preserve a complete decision record.' },
    });
  });

  it('imports a Project Export with fresh local identity and a collision-safe name', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory, {
      now: () => new Date('2026-07-17T10:00:00.000Z'),
    });
    projectServices.push(projects);
    const source = projects.createProject({
      name: 'Portable Project',
      insightSource: 'A local Project can be moved without a cloud account.',
    });
    const workflows = await openWorkflowService(dataDirectory, {
      now: () => new Date('2026-07-17T10:05:00.000Z'),
      textGeneration: {
        async generateDesignBrief() {
          throw new Error('Generation was not expected during import.');
        },
        async generatePrd() {
          throw new Error('Generation was not expected during import.');
        },
      },
    });
    workflowServices.push(workflows);
    const exported = workflows.exportProject(source.id);

    const imported = workflows.importProject(exported.bytes);

    expect(imported).toEqual({
      id: expect.any(String),
      name: 'Portable Project (Imported)',
      insightSource: source.insightSource,
      createdAt: '2026-07-17T10:05:00.000Z',
      updatedAt: '2026-07-17T10:05:00.000Z',
    });
    expect(imported.id).not.toBe(source.id);
    expect(projects.listProjects()).toHaveLength(2);
  });

  it('rejects corrupted and broken-reference Project Exports without changing storage', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-'));
    temporaryDirectories.push(dataDirectory);
    const projects = await openProjectService(dataDirectory);
    projectServices.push(projects);
    const source = projects.createProject({
      name: 'Integrity Source',
      insightSource: 'Only a completely valid Project Export may be imported.',
    });
    const workflows = await openWorkflowService(dataDirectory, {
      textGeneration: {
        async generateDesignBrief() {
          throw new Error('Generation was not expected during import.');
        },
        async generatePrd() {
          throw new Error('Generation was not expected during import.');
        },
      },
    });
    workflowServices.push(workflows);
    const exported = workflows.exportProject(source.id);
    const corruptedFiles = unzipSync(exported.bytes);
    const corruptedPayload = JSON.parse(strFromU8(corruptedFiles['project.json'])) as {
      project: { insightSource: string };
    };
    corruptedPayload.project.insightSource = 'Tampered after export';
    corruptedFiles['project.json'] = strToU8(JSON.stringify(corruptedPayload));

    expect(() => workflows.importProject(Buffer.from(zipSync(corruptedFiles))))
      .toThrow('project.json failed its integrity check');
    expect(projects.listProjects()).toHaveLength(1);

    const brokenFiles = unzipSync(exported.bytes);
    const brokenPayload = JSON.parse(strFromU8(brokenFiles['project.json'])) as {
      currentWorkflow: { artifactIds: { designBrief?: string } };
    };
    brokenPayload.currentWorkflow.artifactIds.designBrief = 'missing-artifact';
    brokenFiles['project.json'] = strToU8(`${JSON.stringify(brokenPayload)}\n`);
    const manifest = JSON.parse(strFromU8(brokenFiles['manifest.json'])) as {
      integrity: { files: Array<{ path: string; byteSize: number; sha256: string }> };
    };
    const projectIntegrity = manifest.integrity.files.find(({ path }) => path === 'project.json')!;
    projectIntegrity.byteSize = brokenFiles['project.json'].byteLength;
    projectIntegrity.sha256 = createHash('sha256')
      .update(brokenFiles['project.json'])
      .digest('hex');
    brokenFiles['manifest.json'] = strToU8(`${JSON.stringify(manifest)}\n`);

    expect(() => workflows.importProject(Buffer.from(zipSync(brokenFiles))))
      .toThrow('does not reference a matching Artifact');
    expect(projects.listProjects()).toHaveLength(1);
  });
});
