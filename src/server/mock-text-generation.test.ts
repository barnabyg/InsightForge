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
});
