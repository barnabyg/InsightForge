import type { TokenUsage } from '../shared/generation.js';
import type { ImageQuality } from '../shared/workflow-configuration.js';

export type ConceptScreenOrdinal = 1 | 2 | 3;

export interface ConceptScreenReference {
  ordinal: ConceptScreenOrdinal;
  png: Buffer;
}

export interface ConceptScreenGenerationResult {
  png: Buffer;
  requestId: string | null;
  responseId: string | null;
  usage: TokenUsage;
}

export interface ImageGenerationBoundary {
  generateConceptScreen(input: {
    model: string;
    quality: ImageQuality;
    stagePrompt: string;
    designBrief: string;
    ordinal: ConceptScreenOrdinal;
    references: ConceptScreenReference[];
    size: 'auto' | `${number}x${number}`;
  }): Promise<ConceptScreenGenerationResult>;
}
