import { beforeEach, describe, expect, it, vi } from 'vitest';

const openAI = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  list: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    models = { list: openAI.list };

    constructor(options: Record<string, unknown>) {
      openAI.options = options;
    }
  },
}));

import { discoverCompatibleModels } from './model-discovery.js';

describe('OpenAI model discovery boundary', () => {
  beforeEach(() => {
    openAI.options = undefined;
    openAI.list.mockReset().mockResolvedValue({
      data: [
        { id: 'gpt-5.6-luna' },
        { id: 'gpt-5.4-mini' },
        { id: 'gpt-4.1' },
        { id: 'gpt-4o' },
        { id: 'gpt-image-2' },
        { id: 'gpt-image-1.5' },
        { id: 'gpt-4o-transcribe' },
        { id: 'gpt-audio-1.5' },
        { id: 'gpt-realtime-2' },
        { id: 'gpt-5.3-codex' },
        { id: 'gpt-5.3-chat-latest' },
        { id: 'text-embedding-3-large' },
        { id: 'dall-e-3' },
      ],
    });
  });

  it('lists once with retries disabled and returns only maintained compatible families', async () => {
    const result = await discoverCompatibleModels('test-key');

    expect(openAI.list).toHaveBeenCalledTimes(1);
    expect(openAI.options).toMatchObject({
      apiKey: 'test-key',
      maxRetries: 0,
    });
    expect(result).toEqual({
      text: ['gpt-4.1', 'gpt-4o', 'gpt-5.4-mini', 'gpt-5.6-luna'],
      image: ['gpt-image-1.5', 'gpt-image-2'],
    });
  });
});
