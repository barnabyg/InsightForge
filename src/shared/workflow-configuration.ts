export type StageId = 'design_brief' | 'concept_screens' | 'prd';
export type StageKind = 'text' | 'image';
export type StageInputId =
  | 'insight_source'
  | 'design_brief'
  | 'concept_screen_set';
export type ImageQuality = 'low' | 'medium' | 'high';

export interface PromptDraft {
  prompt: string;
  updatedAt: string;
}

export interface StageConfiguration {
  id: StageId;
  name: string;
  kind: StageKind;
  prompt: string;
  model: string;
  imageQuality: ImageQuality | null;
  requiredInputs: StageInputId[];
  outputContract: string;
  defaultConfiguration: {
    prompt: string;
    model: string;
    imageQuality: ImageQuality | null;
  };
  draftPrompt: PromptDraft | null;
  updatedAt: string;
}

export interface WorkflowConfiguration {
  stages: StageConfiguration[];
}

export interface CommitStageConfigurationInput {
  prompt: string;
  model: string;
  imageQuality: ImageQuality | null;
}

export interface WorkflowConfigurationExportStage {
  id: StageId;
  prompt: string;
  model: string;
  imageQuality: ImageQuality | null;
}

export interface WorkflowConfigurationExport {
  schemaVersion: 1;
  stages: WorkflowConfigurationExportStage[];
}

export interface ModelCatalog {
  text: string[];
  image: string[];
  source: 'live' | 'cache' | 'defaults' | 'mock';
  checkedAt: string;
}
