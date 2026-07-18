import type { FastifyInstance } from 'fastify';
import type {
  ApplicationMode,
  BootstrapResponse,
} from '../shared/bootstrap.js';
import type { ConnectivityMonitor } from './connectivity-monitor.js';
import { applicationMetadata } from './app-metadata.js';
import type { StorageUsage } from '../shared/storage.js';

export interface BootstrapRouteOptions {
  mode: ApplicationMode;
  readStorage(): Promise<StorageUsage>;
  connectivity: ConnectivityMonitor;
}
export function registerBootstrapRoutes(
  app: FastifyInstance,
  options: BootstrapRouteOptions,
): void {
  app.get('/api/bootstrap', async (): Promise<BootstrapResponse> => ({
    app: applicationMetadata,
    mode: options.mode,
    connectivity: options.connectivity.current(),
    storage: await options.readStorage(),
  }));

  app.get('/api/storage', async () => options.readStorage());
  app.get('/api/connectivity', async () => options.connectivity.waitForResult());
  app.post('/api/connectivity/refresh', async () => options.connectivity.refresh());
}
