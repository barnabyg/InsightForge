import type { FastifyInstance } from 'fastify';
import type {
  ApplicationMode,
  BootstrapResponse,
} from '../shared/bootstrap.js';
import type { ConnectivityMonitor } from './connectivity-monitor.js';
import type { StorageState } from './storage.js';

export interface BootstrapRouteOptions {
  mode: ApplicationMode;
  storage: StorageState;
  connectivity: ConnectivityMonitor;
}
export function registerBootstrapRoutes(
  app: FastifyInstance,
  options: BootstrapRouteOptions,
): void {
  app.get('/api/bootstrap', async (): Promise<BootstrapResponse> => ({
    app: { name: 'InsightForge', version: '0.1.0' },
    mode: options.mode,
    connectivity: options.connectivity.current(),
    storage: options.storage,
  }));

  app.get('/api/connectivity', async () => options.connectivity.waitForResult());
}
