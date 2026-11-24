import { beforeEach, describe, expect, it, vi } from 'vitest';

const openAI = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  generate: vi.fn(),
  edit: vi.fn(),
  toFile: vi.fn(async (bytes: Buffer, name: string) => ({ bytes, name })),
}));

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    images = { generate: openAI.generate, edit: openAI.edit };

    constructor(options: Record<string, unknown>) {
      openAI.options = options;
    }
  },
  toFile: openAI.toFile,
}));

import { createOpenAIImageGeneration } from './openai-image-generation.js';

describe('OpenAI image generation adapter', () => {
  beforeEach(() => {
    openAI.options = undefined;
    openAI.generate.mockReset();
    openAI.edit.mockReset();
    openAI.toFile.mockClear();
  });

  it('generates the first Concept Screen at automatic size and captures diagnostics', async () => {
    const png = Buffer.from('independent-screen-one-png');
    openAI.generate.mockResolvedValue({
      _request_id: 'req_image_01',
      data: [{ b64_json: png.toString('base64') }],
      usage: {
        input_tokens: 210,
        output_tokens: 890,
        total_tokens: 1100,
      },
    });
    const adapter = createOpenAIImageGeneration('test-key');

    const result = await adapter.generateConceptScreen({
      model: 'gpt-image-2',
      quality: 'medium',
      stagePrompt: 'Create three coordinated neutral product interfaces.',
      designBrief: '# Design Brief\n\nHelp homeowners compare retrofit proposals.',
      ordinal: 1,
      references: [],
      size: 'auto',
    });

    expect(openAI.options).toMatchObject({
      apiKey: 'test-key',
      maxRetries: 0,
    });
    expect(openAI.generate).toHaveBeenCalledWith({
      model: 'gpt-image-2',
      prompt: expect.stringMatching(
        /Create three coordinated[\s\S]*Stage Input — Design Brief:[\s\S]*retrofit proposals[\s\S]*Concept Screen 1 of 3/,
      ),
      n: 1,
      size: 'auto',
      quality: 'medium',
      output_format: 'png',
    });
    expect(openAI.edit).not.toHaveBeenCalled();
    expect(result).toEqual({
      png,
      requestId: 'req_image_01',
      responseId: null,
      usage: { inputTokens: 210, outputTokens: 890, totalTokens: 1100 },
    });
  });

  it('generates a later Concept Screen from every earlier reference at fixed dimensions', async () => {
    const screenOne = Buffer.from('screen-one-reference');
    const screenTwo = Buffer.from('screen-two-reference');
    const generated = Buffer.from('screen-three-png');
    openAI.edit.mockResolvedValue({
      _request_id: 'req_image_03',
      data: [{ b64_json: generated.toString('base64') }],
      usage: { input_tokens: 420, output_tokens: 760, total_tokens: 1180 },
    });
    const adapter = createOpenAIImageGeneration('test-key');

    const result = await adapter.generateConceptScreen({
      model: 'gpt-image-2',
      quality: 'high',
      stagePrompt: 'Create one coherent primary journey.',
      designBrief: '# Design Brief\n\nA decision-support workspace.',
      ordinal: 3,
      references: [
        { ordinal: 1, png: screenOne },
        { ordinal: 2, png: screenTwo },
      ],
      size: '1536x1024',
    });

    expect(openAI.toFile).toHaveBeenNthCalledWith(
      1,
      screenOne,
      'concept-screen-1.png',
      { type: 'image/png' },
    );
    expect(openAI.toFile).toHaveBeenNthCalledWith(
      2,
      screenTwo,
      'concept-screen-2.png',
      { type: 'image/png' },
    );
    expect(openAI.edit).toHaveBeenCalledWith({
      model: 'gpt-image-2',
      image: [
        { bytes: screenOne, name: 'concept-screen-1.png' },
        { bytes: screenTwo, name: 'concept-screen-2.png' },
      ],
      prompt: expect.stringMatching(
        /Concept Screen 3 of 3:[\s\S]*Reference Image 1 — Concept Screen 1[\s\S]*Reference Image 2 — Concept Screen 2/,
      ),
      n: 1,
      size: '1536x1024',
      quality: 'high',
      output_format: 'png',
    });
    expect(openAI.generate).not.toHaveBeenCalled();
    expect(result.png).toEqual(generated);
  });

  it('normalizes provider failures and rejects missing image output safely', async () => {
    openAI.generate
      .mockRejectedValueOnce(Object.assign(
        new Error('Authorization failed for sk-secret-value'),
        { request_id: 'req_image_failed' },
      ))
      .mockResolvedValueOnce({ _request_id: 'req_image_empty', data: [], usage: null });
    const adapter = createOpenAIImageGeneration('sk-secret-value');
    const input = {
      model: 'gpt-image-2',
      quality: 'low' as const,
      stagePrompt: 'Create coordinated screens.',
      designBrief: '# Design Brief\n\nA useful product journey.',
      ordinal: 1 as const,
      references: [],
      size: 'auto' as const,
    };

    await expect(adapter.generateConceptScreen(input)).rejects.toMatchObject({
      code: 'openai_request_failed',
      message: 'OpenAI could not generate Concept Screen 1.',
      requestId: 'req_image_failed',
    });
    await expect(adapter.generateConceptScreen(input)).rejects.toMatchObject({
      code: 'invalid_image_output',
      message: 'OpenAI returned no PNG for this Concept Screen.',
      requestId: 'req_image_empty',
    });
  });
});
