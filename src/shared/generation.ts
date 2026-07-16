export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
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
