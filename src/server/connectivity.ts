import OpenAI from 'openai';
import type {
  ApplicationMode,
  ConnectivityState,
} from '../shared/bootstrap.js';

export type CompletedConnectivityState = Exclude<
  ConnectivityState,
  { state: 'checking' }
>;

export interface ConnectivityProbeOptions {
  mode: ApplicationMode;
  apiKey?: string;
  now: () => Date;
}

export function unavailableConnectivity(now: () => Date): CompletedConnectivityState {
  return {
    state: 'unavailable',
    checkedAt: now().toISOString(),
    message: 'OpenAI could not be reached',
  };
}

export function connectivityAtStartup({
  mode,
  apiKey,
  now,
}: ConnectivityProbeOptions): ConnectivityState {
  if (mode === 'mock') {
    return {
      state: 'connected',
      checkedAt: now().toISOString(),
      message: 'Mock OpenAI is ready',
    };
  }

  if (!apiKey) {
    return {
      state: 'api_key_missing',
      checkedAt: now().toISOString(),
      message: 'Set OPENAI_API_KEY to enable generation',
    };
  }

  return {
    state: 'checking',
    checkedAt: null,
    message: 'Checking OpenAI connectivity',
  };
}

export async function checkConnectivity({
  mode,
  apiKey,
  now,
}: ConnectivityProbeOptions): Promise<CompletedConnectivityState> {
  const initialState = connectivityAtStartup({ mode, apiKey, now });

  if (initialState.state !== 'checking') {
    return initialState;
  }

  try {
    const client = new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: 10_000,
    });
    await client.models.list();
    return {
      state: 'connected',
      checkedAt: now().toISOString(),
      message: 'OpenAI is reachable',
    };
  } catch {
    return unavailableConnectivity(now);
  }
}
