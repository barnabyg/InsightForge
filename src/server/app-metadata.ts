import { createRequire } from 'node:module';

interface PackageMetadata {
  version: string;
}

const packageMetadata = createRequire(import.meta.url)('../../package.json') as PackageMetadata;

export const applicationMetadata = Object.freeze({
  name: 'InsightForge',
  version: packageMetadata.version,
});
