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
}

export interface CreateProjectInput {
  name?: string;
  insightSource?: string;
}
