export interface Project {
  id: string;
  name: string;
  insightSource: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  insightSourcePresent: boolean;
  designBriefPresent: boolean;
  conceptScreenSetPresent: boolean;
  prdPresent: boolean;
  updateAvailable: boolean;
}

export interface CreateProjectInput {
  name?: string;
  insightSource?: string;
}
