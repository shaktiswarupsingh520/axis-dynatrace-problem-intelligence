export interface ManagementZone {
  id?: string;
  name?: string;
}

export interface EntityStub {
  entityId?: {
    id?: string;
    type?: string;
  };
  name?: string;
}

export interface Evidence {
  displayName?: string;
  evidenceType?: string;
  entity?: EntityStub;
  groupingEntity?: EntityStub;
  rootCauseRelevant?: boolean;
  startTime?: number;
  endTime?: number;
}

export interface Impact {
  impactType?: string;
  impactedEntity?: EntityStub;
  estimatedAffectedUsers?: number;
  numberOfPotentiallyAffectedServiceCalls?: number;
}

export interface Problem {
  problemId?: string;
  displayId?: string;
  title?: string;
  impactLevel?: string;
  severityLevel?: string;
  status?: string;
  startTime?: number;
  endTime?: number;
  rootCauseEntity?: EntityStub;
  managementZones?: ManagementZone[];
  affectedEntities?: EntityStub[];
  impactedEntities?: EntityStub[];
  evidenceDetails?: {
    details?: Evidence[];
    totalCount?: number;
  };
  impactAnalysis?: {
    impacts?: Impact[];
  };
  recentComments?: {
    comments?: Array<{
      author?: string;
      content?: string;
      createdAt?: number;
    }>;
  };
}

export interface ProblemsResponse {
  problems: Problem[];
  totalCount?: number;
  nextPageKey?: string;
  pageSize?: number;
  warnings?: string[];
}
