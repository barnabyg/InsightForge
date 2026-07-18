import type { StorageUsage } from './storage.js';

export type ApplicationMode = 'live' | 'mock';

export type ConnectivityStatus =
  | 'checking'
  | 'connected'
  | 'api_key_missing'
  | 'unavailable';

export type ConnectivityState =
  | {
      state: 'checking';
      checkedAt: null;
      message: string;
    }
  | {
      state: Exclude<ConnectivityStatus, 'checking'>;
      checkedAt: string;
      message: string;
    };

export interface BootstrapResponse {
  app: { name: string; version: string };
  mode: ApplicationMode;
  connectivity: ConnectivityState;
  storage: StorageUsage;
}
