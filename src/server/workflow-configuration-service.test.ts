import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openWorkflowConfigurationService,
  type WorkflowConfigurationService,
} from './workflow-configuration-service.js';

describe('Workflow Configuration service', () => {
  const temporaryDirectories: string[] = [];
  const services: WorkflowConfigurationService[] = [];

  async function createService() {
    const directory = await mkdtemp(join(tmpdir(), 'insightforge-workflow-config-'));
    temporaryDirectories.push(directory);
    const service = await openWorkflowConfigurationService(directory, {
      now: () => new Date('2026-07-16T15:00:00.000Z'),
    });
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

  it('bootstraps the three shared Stage Configurations with protected Stage Inputs', async () => {
    const service = await createService();

    const configuration = service.getWorkflowConfiguration();

    expect(configuration.stages.map((stage) => ({
      id: stage.id,
      kind: stage.kind,
      model: stage.model,
      imageQuality: stage.imageQuality,
      requiredInputs: stage.requiredInputs,
      draftPrompt: stage.draftPrompt,
    }))).toEqual([
      {
        id: 'design_brief',
        kind: 'text',
        model: 'gpt-5.6-luna',
        imageQuality: null,
        requiredInputs: ['insight_source'],
        draftPrompt: null,
      },
      {
        id: 'concept_screens',
        kind: 'image',
        model: 'gpt-image-2',
        imageQuality: 'medium',
        requiredInputs: ['design_brief'],
        draftPrompt: null,
      },
      {
        id: 'prd',
        kind: 'text',
        model: 'gpt-5.6-luna',
        imageQuality: null,
        requiredInputs: ['design_brief', 'concept_screen_set'],
        draftPrompt: null,
      },
    ]);
    expect(configuration.stages[0].prompt).toContain('Problem or opportunity');
    expect(configuration.stages[1].prompt).toContain('exactly three');
    expect(configuration.stages[1].defaultConfiguration).toMatchObject({
      model: 'gpt-image-2',
      imageQuality: 'medium',
    });
    expect(configuration.stages[2].prompt).toContain('Functional requirements');
    expect(configuration.stages.map(({ prompt }) => prompt).join('\n'))
      .not.toContain('{{insight_source}}');
  });

  it('recovers a Prompt Draft without activating it until an explicit global save', async () => {
    const service = await createService();
    const originalPrompt = service.getWorkflowConfiguration().stages[0].prompt;

    service.savePromptDraft(
      'design_brief',
      'Focus on observed behaviour and clearly separate evidence from assumptions.',
    );
    const drafted = service.getWorkflowConfiguration().stages[0];
    expect(drafted.prompt).toBe(originalPrompt);
    expect(drafted.draftPrompt).toEqual({
      prompt: 'Focus on observed behaviour and clearly separate evidence from assumptions.',
      updatedAt: '2026-07-16T15:00:00.000Z',
    });
    expect(drafted.requiredInputs).toEqual(['insight_source']);

    service.close();
    services.splice(services.indexOf(service), 1);
    const reopened = await openWorkflowConfigurationService(
      temporaryDirectories[0],
      { now: () => new Date('2026-07-16T15:05:00.000Z') },
    );
    services.push(reopened);
    expect(reopened.getWorkflowConfiguration().stages[0].draftPrompt?.prompt)
      .toBe('Focus on observed behaviour and clearly separate evidence from assumptions.');

    reopened.commitStageConfiguration('design_brief', {
      prompt: 'Focus on observed behaviour and clearly separate evidence from assumptions.',
      model: 'gpt-5.4-mini',
      imageQuality: null,
    });
    expect(reopened.getWorkflowConfiguration().stages[0]).toMatchObject({
      prompt: 'Focus on observed behaviour and clearly separate evidence from assumptions.',
      model: 'gpt-5.4-mini',
      imageQuality: null,
      draftPrompt: null,
      updatedAt: '2026-07-16T15:05:00.000Z',
    });
  });

  it('discards drafts and resets one or all stages to the bundled defaults', async () => {
    const service = await createService();
    service.savePromptDraft('prd', 'An unfinished PRD instruction');
    service.discardPromptDraft('prd');
    expect(service.getWorkflowConfiguration().stages[2].draftPrompt).toBeNull();

    service.commitStageConfiguration('design_brief', {
      prompt: 'A custom Design Brief prompt',
      model: 'gpt-5.4-mini',
      imageQuality: null,
    });
    service.commitStageConfiguration('concept_screens', {
      prompt: 'A custom Concept Screen prompt',
      model: 'gpt-image-2',
      imageQuality: 'low',
    });
    service.savePromptDraft('design_brief', 'Another unfinished edit');

    service.resetStageConfiguration('design_brief');
    const resetStage = service.getWorkflowConfiguration().stages[0];
    expect(resetStage).toMatchObject({
      model: 'gpt-5.6-luna',
      imageQuality: null,
      draftPrompt: null,
    });
    expect(resetStage.prompt).toContain('Problem or opportunity');
    expect(service.getWorkflowConfiguration().stages[1].imageQuality).toBe('low');

    service.resetWorkflowConfiguration();
    const resetAll = service.getWorkflowConfiguration().stages;
    expect(resetAll.map(({ model, imageQuality, draftPrompt }) => ({
      model,
      imageQuality,
      draftPrompt,
    }))).toEqual([
      { model: 'gpt-5.6-luna', imageQuality: null, draftPrompt: null },
      { model: 'gpt-image-2', imageQuality: 'medium', draftPrompt: null },
      { model: 'gpt-5.6-luna', imageQuality: null, draftPrompt: null },
    ]);
  });

  it('round-trips a versioned export and rejects an invalid import before any write', async () => {
    const service = await createService();
    service.commitStageConfiguration('prd', {
      prompt: 'A PRD prompt worth backing up',
      model: 'gpt-5.4',
      imageQuality: null,
    });
    service.savePromptDraft('prd', 'This unfinished draft must not be exported');

    const exported = service.exportWorkflowConfiguration();
    expect(exported).toEqual({
      schemaVersion: 1,
      stages: [
        expect.objectContaining({
          id: 'design_brief',
          model: 'gpt-5.6-luna',
          imageQuality: null,
        }),
        expect.objectContaining({
          id: 'concept_screens',
          model: 'gpt-image-2',
          imageQuality: 'medium',
        }),
        {
          id: 'prd',
          prompt: 'A PRD prompt worth backing up',
          model: 'gpt-5.4',
          imageQuality: null,
        },
      ],
    });
    expect(JSON.stringify(exported)).not.toContain('draft');
    expect(JSON.stringify(exported)).not.toContain('apiKey');

    service.resetWorkflowConfiguration();
    service.importWorkflowConfiguration(exported);
    expect(service.getWorkflowConfiguration().stages[2]).toMatchObject({
      prompt: 'A PRD prompt worth backing up',
      model: 'gpt-5.4',
      draftPrompt: null,
    });

    const beforeInvalidImport = service.exportWorkflowConfiguration();
    expect(() => service.importWorkflowConfiguration({
      schemaVersion: 2,
      stages: [],
    })).toThrow('Unsupported Workflow Configuration schema version');
    expect(() => service.importWorkflowConfiguration({
      ...beforeInvalidImport,
      apiKey: 'must-never-enter-configuration-imports',
    })).toThrow('unknown fields');
    expect(service.exportWorkflowConfiguration()).toEqual(beforeInvalidImport);
  });

  it('rejects models and settings that are incompatible with the target stage', async () => {
    const service = await createService();

    expect(() => service.commitStageConfiguration('design_brief', {
      prompt: 'A valid prompt',
      model: 'gpt-image-2',
      imageQuality: null,
    })).toThrow('Design Brief requires a compatible text model');
    expect(() => service.commitStageConfiguration('concept_screens', {
      prompt: 'A valid image prompt',
      model: 'gpt-5.6-luna',
      imageQuality: 'high',
    })).toThrow('Concept Screens requires a compatible image model');
    expect(() => service.commitStageConfiguration('prd', {
      prompt: 'A valid PRD prompt',
      model: 'gpt-audio-1.5',
      imageQuality: null,
    })).toThrow('PRD requires a compatible multimodal text model');
    expect(() => service.commitStageConfiguration('prd', {
      prompt: 'A valid PRD prompt',
      model: 'o3-mini',
      imageQuality: null,
    })).toThrow('PRD requires a compatible multimodal text model');
    expect(() => service.commitStageConfiguration('design_brief', {
      prompt: 'A valid Design Brief prompt',
      model: 'o3-mini',
      imageQuality: null,
    })).not.toThrow();
  });
});
