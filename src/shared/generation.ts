export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type ConceptScreenOrdinal = 1 | 2 | 3;

export interface ConceptScreenProgressEvent {
  projectId: string;
  runId: string;
  phase: 'generating' | 'validating' | 'promoting' | 'completed' | 'failed';
  currentOrdinal: ConceptScreenOrdinal | null;
  completedOperationCount: number;
  elapsedMs: number;
}

export interface ConceptScreenValidation {
  status: 'valid' | 'valid_with_warnings';
  screenCount: number;
  width: number;
  height: number;
  warnings: Array<{
    code: 'undersized_concept_screens';
    message: string;
  }>;
}

export interface ConceptScreen {
  assetId: string;
  ordinal: ConceptScreenOrdinal;
  width: number;
  height: number;
  byteSize: number;
  mediaType: 'image/png';
  downloadUrl: string;
  requestId: string | null;
  responseId: string | null;
  usage: TokenUsage;
}

export interface ConceptScreenSetArtifact {
  id: string;
  projectId: string;
  stageId: 'concept_screens';
  runId: string;
  createdAt: string;
  validation: ConceptScreenValidation;
  screens: ConceptScreen[];
}

export interface ConceptScreenOperation {
  ordinal: ConceptScreenOrdinal;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  requestId: string | null;
  responseId: string | null;
  usage: TokenUsage | null;
  error: { code: string; message: string } | null;
}

export interface ConceptScreenAttemptHistory {
  status: 'failed' | 'cancelled';
  completedAt: string | null;
  durationMs: number | null;
  usage: TokenUsage | null;
  error: { code: string; message: string } | null;
  operations: ConceptScreenOperation[];
}

export interface ConceptScreenRun {
  id: string;
  projectId: string;
  stageId: 'concept_screens';
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  stagePrompt: string;
  model: string;
  imageQuality: 'low' | 'medium' | 'high';
  stageConfigurationUpdatedAt: string;
  stageInput: {
    name: 'Design Brief';
    value: string;
    artifactId: string | null;
    runId: string | null;
  };
  assembledRequest: string;
  completedOperationCount: number;
  operations: ConceptScreenOperation[];
  attemptHistory: ConceptScreenAttemptHistory[];
  usage: TokenUsage | null;
  validation: ConceptScreenValidation | null;
  error: { code: string; message: string } | null;
}

export interface SanityWarning {
  code: 'below_recommended_word_count';
  message: string;
}

export interface ArtifactValidation {
  status: 'valid' | 'valid_with_warnings';
  wordCount: number;
  warnings: SanityWarning[];
}

export interface DesignBriefArtifact {
  id: string;
  projectId: string;
  stageId: 'design_brief';
  runId: string;
  markdown: string;
  createdAt: string;
  validation: ArtifactValidation;
}

export interface DesignBriefRun {
  id: string;
  projectId: string;
  stageId: 'design_brief';
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  stagePrompt: string;
  model: string;
  stageConfigurationUpdatedAt: string;
  stageInput: {
    name: 'Insight Source';
    value: string;
  };
  assembledRequest: string;
  responseId: string | null;
  requestId: string | null;
  usage: TokenUsage | null;
  validation: ArtifactValidation | null;
  error: {
    code: string;
    message: string;
  } | null;
}

export interface ProjectWorkflow {
  projectId: string;
  canGenerateDesignBrief: boolean;
  generationBlocker: string | null;
  designBrief: DesignBriefArtifact | null;
  lastDesignBriefRun: DesignBriefRun | null;
  designBriefConfiguration: {
    model: string;
    promptUpdatedAt: string;
  };
  canGenerateConceptScreens: boolean;
  conceptScreenGenerationBlocker: string | null;
  conceptScreenSet: ConceptScreenSetArtifact | null;
  lastConceptScreenRun: ConceptScreenRun | null;
  conceptScreenConfiguration: {
    model: string;
    imageQuality: 'low' | 'medium' | 'high';
    promptUpdatedAt: string;
  };
}

export interface DesignBriefGenerationResult {
  markdown: string;
  responseId: string;
  requestId: string;
  usage: TokenUsage;
}

export interface TextGenerationBoundary {
  generateDesignBrief(input: {
    model: string;
    stagePrompt: string;
    insightSource: string;
  }): Promise<DesignBriefGenerationResult>;
}
