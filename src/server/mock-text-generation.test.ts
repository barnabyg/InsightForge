import { describe, expect, it } from 'vitest';
import { createMockTextGeneration } from './mock-text-generation.js';

describe('Mock text generation boundary', () => {
  it('returns the same realistic structured result for the same Design Brief input', async () => {
    const mock = createMockTextGeneration();
    const input = {
      model: 'gpt-5.6-luna',
      stagePrompt: 'Create a disciplined Design Brief.',
      insightSource: 'People cannot compare home-energy proposals confidently.',
    };

    const first = await mock.generateDesignBrief(input);
    const second = await mock.generateDesignBrief(input);

    expect(second).toEqual(first);
    expect(first.markdown).toContain('# Design Brief');
    expect(first.markdown).toContain('People cannot compare home-energy proposals confidently.');
    expect(first.markdown).toContain('## Scope and non-goals');
    expect(first.markdown.match(/[\p{L}\p{N}]+/gu)?.length).toBeGreaterThan(250);
    expect(first).toMatchObject({
      responseId: expect.stringMatching(/^mock_resp_/),
      requestId: expect.stringMatching(/^mock_req_/),
      usage: {
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        totalTokens: expect.any(Number),
      },
    });
  });

  it('returns the same realistic PRD for the same Design Brief and three Concept Screens', async () => {
    const mock = createMockTextGeneration();
    const input = {
      model: 'gpt-5.6-luna',
      stagePrompt: 'Create a rigorous PRD that reconciles every screen.',
      designBrief: '# Design Brief\n\nA comparison journey with an explicit decision record.',
      conceptScreens: [
        { ordinal: 1 as const, png: Buffer.from('screen-one') },
        { ordinal: 2 as const, png: Buffer.from('screen-two') },
        { ordinal: 3 as const, png: Buffer.from('screen-three') },
      ],
    };

    const first = await mock.generatePrd(input);
    const second = await mock.generatePrd(input);

    expect(second).toEqual(first);
    expect(first.markdown).toContain('# Product Requirements Document');
    expect(first.markdown).toContain('## Concept Screen walkthrough');
    expect(first.markdown).toContain('Concept Screen 1');
    expect(first.markdown).toContain('Concept Screen 2');
    expect(first.markdown).toContain('Concept Screen 3');
    expect(first.markdown).toContain('FR-001');
    expect(first.markdown.match(/[\p{L}\p{N}]+/gu)?.length).toBeGreaterThan(250);
    expect(first).toMatchObject({
      responseId: expect.stringMatching(/^mock_resp_/),
      requestId: expect.stringMatching(/^mock_req_/),
      usage: {
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        totalTokens: expect.any(Number),
      },
    });
  });
});
