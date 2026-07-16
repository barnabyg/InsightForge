import { beforeEach, describe, expect, it, vi } from 'vitest';

const openAI = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  create: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    responses = { create: openAI.create };

    constructor(options: Record<string, unknown>) {
      openAI.options = options;
    }
  },
}));

import { createOpenAITextGeneration } from './openai-text-generation.js';

describe('OpenAI text generation adapter', () => {
  beforeEach(() => {
    openAI.options = undefined;
    openAI.create.mockReset();
  });

  it('assembles a strict Design Brief response request and captures diagnostics', async () => {
    openAI.create.mockResolvedValue({
      id: 'resp_openai_01',
      _request_id: 'req_openai_01',
      status: 'completed',
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: JSON.stringify({
            markdown: '# Design Brief\n\n## Problem\n\nComparing proposals is difficult.',
          }),
        }],
      }],
      usage: {
        input_tokens: 180,
        output_tokens: 75,
        total_tokens: 255,
      },
    });
    const adapter = createOpenAITextGeneration('test-key');

    const result = await adapter.generateDesignBrief({
      model: 'gpt-5.6-luna',
      stagePrompt: 'Create a disciplined Design Brief in Markdown.',
      insightSource: 'Homeowners cannot compare installer quotes confidently.',
    });

    expect(openAI.options).toMatchObject({
      apiKey: 'test-key',
      maxRetries: 0,
    });
    expect(openAI.create).toHaveBeenCalledWith({
      model: 'gpt-5.6-luna',
      input: [
        {
          role: 'developer',
          content: [{
            type: 'input_text',
            text: 'Create a disciplined Design Brief in Markdown.',
          }],
        },
        {
          role: 'user',
          content: [{
            type: 'input_text',
            text: 'Stage Input — Insight Source:\nHomeowners cannot compare installer quotes confidently.',
          }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'design_brief_artifact',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              markdown: { type: 'string', minLength: 1 },
            },
            required: ['markdown'],
            additionalProperties: false,
          },
        },
      },
    });
    expect(result).toEqual({
      markdown: '# Design Brief\n\n## Problem\n\nComparing proposals is difficult.',
      responseId: 'resp_openai_01',
      requestId: 'req_openai_01',
      usage: { inputTokens: 180, outputTokens: 75, totalTokens: 255 },
    });
  });

  it('normalizes SDK failures without exposing credentials or raw provider details', async () => {
    openAI.create.mockRejectedValue(Object.assign(
      new Error('Authorization failed for sk-secret-value'),
      { request_id: 'req_failed_01' },
    ));
    const adapter = createOpenAITextGeneration('sk-secret-value');

    await expect(adapter.generateDesignBrief({
      model: 'gpt-5.6-luna',
      stagePrompt: 'Create a Design Brief.',
      insightSource: 'A useful product observation.',
    })).rejects.toMatchObject({
      code: 'openai_request_failed',
      message: 'OpenAI could not generate the Design Brief.',
      requestId: 'req_failed_01',
    });
  });

  it('rejects incomplete and refusal responses before they become Artifacts', async () => {
    openAI.create
      .mockResolvedValueOnce({
        id: 'resp_incomplete_01',
        _request_id: 'req_incomplete_01',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
        usage: null,
      })
      .mockResolvedValueOnce({
        id: 'resp_refusal_01',
        _request_id: 'req_refusal_01',
        status: 'completed',
        output: [{
          type: 'message',
          content: [{ type: 'refusal', refusal: 'Unable to comply.' }],
        }],
        usage: null,
      });
    const adapter = createOpenAITextGeneration('test-key');
    const input = {
      model: 'gpt-5.6-luna',
      stagePrompt: 'Create a Design Brief.',
      insightSource: 'A useful product observation.',
    };

    await expect(adapter.generateDesignBrief(input)).rejects.toMatchObject({
      code: 'openai_incomplete',
      requestId: 'req_incomplete_01',
      responseId: 'resp_incomplete_01',
    });
    await expect(adapter.generateDesignBrief(input)).rejects.toMatchObject({
      code: 'openai_refusal',
      requestId: 'req_refusal_01',
      responseId: 'resp_refusal_01',
    });
  });
});
