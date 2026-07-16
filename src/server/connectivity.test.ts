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

import { checkConnectivity } from './connectivity.js';

describe('OpenAI connectivity boundary', () => {
  beforeEach(() => {
    openAI.options = undefined;
    openAI.list.mockReset().mockResolvedValue({ data: [] });
  });

  it('checks model discovery exactly once with SDK retries disabled', async () => {
    const result = await checkConnectivity({
      mode: 'live',
      apiKey: 'test-key',
      now: () => new Date('2026-07-16T10:30:00.000Z'),
    });

    expect(result.state).toBe('connected');
    expect(openAI.list).toHaveBeenCalledTimes(1);
    expect(openAI.options).toMatchObject({
      apiKey: 'test-key',
      maxRetries: 0,
    });
  });
});
