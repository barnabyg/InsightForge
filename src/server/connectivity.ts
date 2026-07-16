import OpenAI from 'openai';

export type ApplicationMode = 'live' | 'mock';

export interface ConnectivityState {
  state: 'connected' | 'api_key_missing' | 'unavailable';
  checkedAt: string;
  message: string;
}

export interface ConnectivityProbeOptions {
  mode: ApplicationMode;
  apiKey?: string;
  now: () => Date;
}

export async function checkConnectivity({
  mode,
  apiKey,
  now,
}: ConnectivityProbeOptions): Promise<ConnectivityState> {
  const checkedAt = now().toISOString();

  if (mode === 'mock') {
    return {
      state: 'connected',
      checkedAt,
      message: 'Mock OpenAI is ready',
    };
  }

  if (!apiKey) {
    return {
      state: 'api_key_missing',
      checkedAt,
      message: 'Set OPENAI_API_KEY to enable generation',
    };
  }

  try {
    const client = new OpenAI({ apiKey });
    await client.models.list();
    return {
      state: 'connected',
      checkedAt,
      message: 'OpenAI is reachable',
    };
  } catch {
    return {
      state: 'unavailable',
      checkedAt,
      message: 'OpenAI could not be reached',
    };
  }
}

