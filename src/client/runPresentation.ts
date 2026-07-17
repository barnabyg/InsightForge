import type { RunKind } from '../shared/generation.js';

const runKindLabels: Record<RunKind, string> = {
  initial: 'Initial Run',
  regeneration: 'Regeneration',
  variation: 'Variation Run',
};

export function runKindLabel(runKind: RunKind): string {
  return runKindLabels[runKind];
}
