import { useCallback, useEffect, useState } from 'react';
import type {
  ApplicationMode,
  BootstrapResponse,
  ConnectivityState,
  ConnectivityStatus,
} from '../shared/bootstrap.js';
import type { StorageUsage } from '../shared/storage.js';

export interface ShellState {
  mode: ApplicationMode | null;
  connectivity: ConnectivityStatus;
  message: string;
  checkedAt: string | null;
  storage: StorageUsage | null;
}

export interface BootstrapController {
  shell: ShellState;
  refreshConnectivity(): Promise<void>;
  refreshStorage(): Promise<void>;
  refreshing: boolean;
}
const initialState: ShellState = {
  mode: null,
  connectivity: 'checking',
  message: 'Checking OpenAI connectivity',
  checkedAt: null,
  storage: null,
};

function shellState(
  mode: ApplicationMode,
  connectivity: ConnectivityState,
  storage: StorageUsage | null,
): ShellState {
  return {
    mode,
    connectivity: connectivity.state,
    message: connectivity.message,
    checkedAt: connectivity.checkedAt,
    storage,
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
        setState(shellState(result.mode, result.connectivity, result.storage));

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
          setState(shellState(result.mode, connectivity, result.storage));
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
          storage: null,
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
      setState((current) => shellState(
        current.mode ?? 'live',
        connectivity,
        current.storage,
      ));
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

  const refreshStorage = useCallback(async () => {
    try {
      const response = await fetch('/api/storage');
      if (!response.ok) return;
      const storage = await response.json() as StorageUsage;
      setState((current) => ({ ...current, storage }));
    } catch {
      // Existing storage information remains useful during a transient local failure.
    }
  }, []);

  return { shell: state, refreshConnectivity, refreshStorage, refreshing };
}
