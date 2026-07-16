import type { ConnectivityState } from '../shared/bootstrap.js';
import {
  checkConnectivity,
  connectivityAtStartup,
  type CompletedConnectivityState,
  type ConnectivityProbeOptions,
} from './connectivity.js';

export interface ConnectivityMonitor {
  current(): ConnectivityState;
  start(): void;
  waitForResult(): Promise<ConnectivityState>;
}
export function createConnectivityMonitor(
  options: ConnectivityProbeOptions,
  probe?: () => Promise<CompletedConnectivityState>,
): ConnectivityMonitor {
  let state = connectivityAtStartup(options);
  let inFlight: Promise<ConnectivityState> | undefined;

  const waitForResult = (): Promise<ConnectivityState> => {
    if (state.state !== 'checking') {
      return Promise.resolve(state);
    }

    if (!inFlight) {
      inFlight = (probe ?? (() => checkConnectivity(options)))()
        .then((result) => {
          state = result;
          return state;
        })
        .catch(() => {
          state = {
            state: 'unavailable',
            checkedAt: options.now().toISOString(),
            message: 'OpenAI could not be reached',
          };
          return state;
        });
    }

    return inFlight;
  };

  return {
    current: () => state,
    start: () => {
      void waitForResult();
    },
    waitForResult,
  };
}
