export interface ProjectStorageUsage {
  projectId: string;
  name: string;
  estimatedBytes: number;
  structuredBytes: number;
  assetBytes: number;
}

export interface StorageUsage {
  state: 'ready';
  dataDirectory: string;
  totalBytes: number;
  databaseBytes: number;
  assetBytes: number;
  availableBytes: number;
  projects: ProjectStorageUsage[];
}
