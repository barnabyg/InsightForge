import type { ConnectivityState } from '../shared/bootstrap.js';
import {
  checkConnectivity,
  connectivityAtStartup,
  unavailableConnectivity,
  type CompletedConnectivityState,
  type ConnectivityProbeOptions,
} from './connectivity.js';

export interface ConnectivityMonitor {
  current(): ConnectivityState;
  refresh(): Promise<ConnectivityState>;
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
          state = unavailableConnectivity(options.now);
          return state;
        });
    }

    return inFlight;
  };

  return {
    current: () => state,
    refresh: () => {
      if (state.state === 'checking' && inFlight) {
        return inFlight;
      }
      state = connectivityAtStartup(options);
      inFlight = undefined;
      return waitForResult();
    },
    start: () => {
      void waitForResult();
    },
    waitForResult,
  };
}
