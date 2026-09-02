import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

interface GetProblemDetailsPayload {
  problemId: string;
}

interface EvidenceLike {
  displayName?: string;
  evidenceType?: string;
  entity?: { name?: string; entityId?: { id?: string; type?: string } };
  groupingEntity?: { name?: string };
  rootCauseRelevant?: boolean;
}

interface ImpactLike {
  impactType?: string;
  impactedEntity?: { name?: string };
  estimatedAffectedUsers?: number;
  numberOfPotentiallyAffectedServiceCalls?: number;
}

type DqlRecord = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const recordValue = (value: unknown): DqlRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as DqlRecord)
    : undefined;

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const executeDql = async (query: string): Promise<DqlRecord[]> => {
  try {
    const started = await queryExecutionClient.queryExecute({
      body: { query },
    });

    if (started.result?.records) {
      return started.result.records as DqlRecord[];
    }

    if (!started.requestToken) {
      return [];
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const polled = await queryExecutionClient.queryPoll({
        requestToken: started.requestToken,
      });

      if (polled.result?.records) {
        return polled.result.records as DqlRecord[];
      }

      if (polled.state === 'FAILED' || polled.state === 'CANCELLED' || polled.state === 'RESULT_GONE') {
        return [];
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch {
    return [];
  }

  return [];
};

const escapeDqlString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const loadGrailProblemContext = async (problemId: string) => {
  const safeId = escapeDqlString(problemId);
  const problemQuery = `fetch dt.davis.problems
| filter display_id == "${safeId}"
| fields display_id, event.name, event.description, event.start, event.end, dt.analysis.ready, dt.davis.event_ids, dt.davis.affected_users_count, dt.davis.impact_level, root_cause.smartscape_entity, smartscape.affected_entities
| limit 1`;

  const problemRecords = await executeDql(problemQuery);
  const problemRecord = problemRecords[0];
  if (!problemRecord) {
    return undefined;
  }

  const eventIds = stringArray(problemRecord['dt.davis.event_ids']);
  let eventRecords: DqlRecord[] = [];

  if (eventIds.length > 0) {
    const eventArray = eventIds.map((id) => `"${escapeDqlString(id)}"`).join(', ');
    const eventQuery = `fetch dt.davis.events
| filter in(event.id, array(${eventArray}))
| fields event.id, event.name, event.description, event.start, event.end, event.type, event.category, event.severity, dt.smartscape_source.id, dt.smartscape_source.type, dt.davis.is_rootcause_relevant, dt.davis.analysis_time_budget, dt.davis.analysis_trigger_delay
| sort event.start asc
| limit 100`;
    eventRecords = await executeDql(eventQuery);
  }

  return { problemRecord, eventRecords };
};

const buildCausalAnalysis = (
  problem: {
    title?: string;
    impactLevel?: string;
    rootCauseEntity?: { name?: string; entityId?: { id?: string; type?: string } };
    evidenceDetails?: { details?: EvidenceLike[] };
    impactAnalysis?: { impacts?: ImpactLike[] };
  },
  grailContext?: {
    problemRecord: DqlRecord;
    eventRecords: DqlRecord[];
  },
) => {
  const title = text(problem.title) || 'Dynatrace problem';
  const evidence = problem.evidenceDetails?.details ?? [];
  const rootCauseEvidence = evidence.find((item) => item.rootCauseRelevant);
  const grailRootCause = recordValue(grailContext?.problemRecord['root_cause.smartscape_entity']);
  const grailRootCauseName = text(grailRootCause?.name);
  const grailRootCauseId = text(grailRootCause?.id);
  const grailRootCauseType = text(grailRootCause?.type);

  const apiRootCauseName = text(problem.rootCauseEntity?.name);
  const apiRootCauseId = text(problem.rootCauseEntity?.entityId?.id);
  const apiRootCauseType = text(problem.rootCauseEntity?.entityId?.type);
  const evidenceRootCauseName = text(rootCauseEvidence?.entity?.name);
  const evidenceRootCauseId = text(rootCauseEvidence?.entity?.entityId?.id);
  const evidenceRootCauseType = text(rootCauseEvidence?.entity?.entityId?.type);

  const rootCauseName = grailRootCauseName || apiRootCauseName || evidenceRootCauseName;
  const rootCauseId = grailRootCauseId || apiRootCauseId || evidenceRootCauseId;
  const rootCauseType = grailRootCauseType || apiRootCauseType || evidenceRootCauseType;

  const eventDescriptions = (grailContext?.eventRecords ?? [])
    .map((event) => text(event['event.description']))
    .filter(Boolean);
  const eventNames = (grailContext?.eventRecords ?? [])
    .map((event) => text(event['event.name']))
    .filter(Boolean);
  const causalEvents = (grailContext?.eventRecords ?? [])
    .filter((event) => event['dt.davis.is_rootcause_relevant'] === true)
    .map((event) => ({
      id: text(event['event.id']),
      name: text(event['event.name']),
      description: text(event['event.description']),
      entityId: text(event['dt.smartscape_source.id']),
      entityType: text(event['dt.smartscape_source.type']),
      category: text(event['event.category']),
      severity: event['event.severity'],
      start: event['event.start'],
    }))
    .filter((event) => event.id || event.name || event.description);

  const apiEvidenceText = evidence
    .map((item) => {
      const display = text(item.displayName) || text(item.evidenceType);
      const entity = text(item.entity?.name);
      const grouping = text(item.groupingEntity?.name);
      return [display, entity ? `entity ${entity}` : '', grouping ? `grouped by ${grouping}` : '']
        .filter(Boolean)
        .join(' — ');
    })
    .filter(Boolean);

  const allEvidence = [...new Set([...eventDescriptions, ...apiEvidenceText])].slice(0, 12);
  const primaryEvent = causalEvents[0];
  const ready = grailContext?.problemRecord['dt.analysis.ready'];

  let probableCause: string;
  let remediation: string;
  let confidence: string;

  if (rootCauseName) {
    const entityLabel = [rootCauseName, rootCauseType ? `(${rootCauseType})` : ''].filter(Boolean).join(' ');
    const supporting = primaryEvent?.description || primaryEvent?.name || allEvidence[0];
    probableCause = supporting
      ? `Dynatrace Intelligence identified ${entityLabel} as the root-cause entity. The strongest supporting signal is: ${supporting}.`
      : `Dynatrace Intelligence identified ${entityLabel} as the root-cause entity for this problem.`;
    remediation = `Start investigation at ${entityLabel}. Validate the metric/event that triggered the problem, then follow the dependency path from this entity to the impacted service or workload before changing configuration.`;
    confidence = 'High';
  } else if (primaryEvent?.entityId) {
    probableCause = `No explicit problem root-cause entity is currently exposed, but the root-cause-relevant Davis event points to ${primaryEvent.entityId}${primaryEvent.entityType ? ` (${primaryEvent.entityType})` : ''}. Supporting signal: ${primaryEvent.description || primaryEvent.name || 'Davis event'}.`;
    remediation = `Investigate ${primaryEvent.entityId} first. Correlate its event timeline with the affected entities and verify the underlying metric, log, deployment or dependency signal before remediation.`;
    confidence = ready === false ? 'Pending Dynatrace Intelligence analysis' : 'Medium';
  } else if (allEvidence.length > 0) {
    probableCause = `Dynatrace has not exposed a definitive root-cause entity yet. The strongest observed evidence is: ${allEvidence[0]}. This is evidence, not a confirmed root cause.`;
    remediation = 'Wait for Dynatrace Intelligence analysis to become ready, then re-evaluate the root-cause entity and causal events. Until then, investigate the entities named in the evidence without treating any single one as confirmed root cause.';
    confidence = ready === false ? 'Pending Dynatrace Intelligence analysis' : 'Evidence only';
  } else {
    probableCause = 'Dynatrace has not exposed enough causal evidence to determine a root cause yet.';
    remediation = 'Wait for Dynatrace Intelligence analysis to complete and refresh the problem details before assigning a root cause.';
    confidence = ready === false ? 'Pending Dynatrace Intelligence analysis' : 'Insufficient evidence';
  }

  const impacts = problem.impactAnalysis?.impacts ?? [];
  const users = impacts.reduce((sum, item) => sum + (item.estimatedAffectedUsers ?? 0), 0);
  const calls = impacts.reduce((sum, item) => sum + (item.numberOfPotentiallyAffectedServiceCalls ?? 0), 0);
  const impactParts = [
    problem.impactLevel ? `Impact level: ${problem.impactLevel}.` : '',
    users > 0 ? `Estimated affected users: ${users}.` : '',
    calls > 0 ? `Potentially affected service calls: ${calls}.` : '',
    impacts.length > 0 ? `Dynatrace Intelligence identified ${impacts.length} impact relationship${impacts.length === 1 ? '' : 's'}.` : '',
  ].filter(Boolean);

  const description = text(grailContext?.problemRecord['event.description']) || allEvidence.join('. ') || title;

  return {
    description,
    rootCause: rootCauseName || 'No definitive root-cause entity exposed yet',
    rootCauseEntityId: rootCauseId || undefined,
    rootCauseEntityType: rootCauseType || undefined,
    probableCause,
    impactSummary: impactParts.join(' ') || `Impact level: ${problem.impactLevel ?? 'not provided'}.`,
    remediation,
    confidence,
    evidence: allEvidence,
    causalEvents,
    eventIds: stringArray(grailContext?.problemRecord['dt.davis.event_ids']),
    analysisReady: ready,
    affectedUsers: typeof grailContext?.problemRecord['dt.davis.affected_users_count'] === 'number'
      ? grailContext.problemRecord['dt.davis.affected_users_count']
      : undefined,
    eventNames: [...new Set(eventNames)].slice(0, 12),
  };
};

export default async function (payload: GetProblemDetailsPayload) {
  if (!payload?.problemId) {
    throw new Error('problemId is required');
  }

  const problem = await problemsClient.getProblem({
    problemId: payload.problemId,
    fields: 'evidenceDetails,impactAnalysis,recentComments',
  });

  const grailContext = await loadGrailProblemContext(payload.problemId);

  return {
    ...problem,
    problemAnalysis: buildCausalAnalysis(problem, grailContext),
  };
}
