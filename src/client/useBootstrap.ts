import { useCallback, useEffect, useState } from 'react';
import type {
  ApplicationMode,
  BootstrapResponse,
  ConnectivityState,
  ConnectivityStatus,
} from '../shared/bootstrap.js';

export interface ShellState {
  mode: ApplicationMode | null;
  connectivity: ConnectivityStatus;
  message: string;
  checkedAt: string | null;
}

export interface BootstrapController {
  shell: ShellState;
  refreshConnectivity(): Promise<void>;
  refreshing: boolean;
}
const initialState: ShellState = {
  mode: null,
  connectivity: 'checking',
  message: 'Checking OpenAI connectivity',
  checkedAt: null,
};

function shellState(
  mode: ApplicationMode,
  connectivity: ConnectivityState,
): ShellState {
  return {
    mode,
    connectivity: connectivity.state,
    message: connectivity.message,
    checkedAt: connectivity.checkedAt,
  };
}

export function useBootstrap(): BootstrapController {
  const [state, setState] = useState<ShellState>(initialState);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function bootstrap() {
      try {
        const response = await fetch('/api/bootstrap', { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Bootstrap failed with status ${response.status}`);
        }
        const result = await response.json() as BootstrapResponse;
        setState(shellState(result.mode, result.connectivity));

        if (result.connectivity.state === 'checking') {
          const connectivityResponse = await fetch('/api/connectivity', {
            signal: controller.signal,
          });
          if (!connectivityResponse.ok) {
            throw new Error(
              `Connectivity check failed with status ${connectivityResponse.status}`,
            );
          }
          const connectivity = await connectivityResponse.json() as ConnectivityState;
          setState(shellState(result.mode, connectivity));
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setState({
          mode: null,
          connectivity: 'unavailable',
          message: 'The local InsightForge server could not be reached',
          checkedAt: null,
        });
      }
    }

    void bootstrap();
    return () => controller.abort();
  }, []);

  const refreshConnectivity = useCallback(async () => {
    setRefreshing(true);
    setState((current) => ({
      ...current,
      connectivity: 'checking',
      message: 'Checking OpenAI connectivity',
      checkedAt: null,
    }));

    try {
      const response = await fetch('/api/connectivity/refresh', { method: 'POST' });
      if (!response.ok) {
        throw new Error(`Connectivity refresh failed with status ${response.status}`);
      }
      const connectivity = await response.json() as ConnectivityState;
      setState((current) => shellState(current.mode ?? 'live', connectivity));
    } catch {
      setState((current) => ({
        ...current,
        connectivity: 'unavailable',
        message: 'The local InsightForge server could not be reached',
        checkedAt: null,
      }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { shell: state, refreshConnectivity, refreshing };
}
