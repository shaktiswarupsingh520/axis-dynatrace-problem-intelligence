import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';

type Payload = { problemId: string };
type EntityStub = { name?: string; entityId?: { id?: string; type?: string } };
type Evidence = { displayName?: string; evidenceType?: string; rootCauseRelevant?: boolean; entity?: EntityStub };
type Problem = {
  problemId?: string;
  displayId?: string;
  title?: string;
  status?: string;
  severityLevel?: string;
  impactLevel?: string;
  startTime?: number;
  endTime?: number;
  rootCauseEntity?: EntityStub | null;
  affectedEntities?: EntityStub[];
  managementZones?: Array<{ id?: string; name?: string }>;
  evidenceDetails?: { details?: Evidence[] };
  impactAnalysis?: { impacts?: Array<{ impactType?: string; impactedEntity?: EntityStub; estimatedAffectedUsers?: number }> };
};

const duration = (start?: number, end?: number): string => {
  if (!Number.isFinite(start)) return '—';
  const finish = end !== undefined && end >= 0 ? end : Date.now();
  const minutes = Math.max(0, finish - start) / 60000;
  return minutes < 60 ? `${minutes.toFixed(1)} min` : minutes < 1440 ? `${(minutes / 60).toFixed(1)} h` : `${(minutes / 1440).toFixed(1)} d`;
};
const q = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const entityIds = (entities?: EntityStub[]): string[] =>
  (entities ?? []).map((entity) => entity.entityId?.id).filter((id): id is string => Boolean(id));
const zoneIds = (zones?: Array<{ id?: string; name?: string }>): string[] =>
  (zones ?? []).map((zone) => zone.id).filter((id): id is string => Boolean(id));

async function loadRecurrenceCount(problem: Problem): Promise<{ count: number; occurrences: Array<{ problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string }> }> {
  const title = problem.title?.trim();
  const affectedIds = entityIds(problem.affectedEntities);
  const managementZoneIds = zoneIds(problem.managementZones);
  if (!title || !affectedIds.length || !managementZoneIds.length) return { count: 0, occurrences: [] };

  const selector = [
    `affectedEntities(${affectedIds.map((id) => `"${q(id)}"`).join(',')})`,
    `managementZoneIds(${managementZoneIds.map((id) => `"${q(id)}"`).join(',')})`,
  ].join(',');

  try {
    const candidates: Problem[] = [];
    let response = await problemsClient.getProblems({
      from: 'now-30d',
      to: 'now',
      pageSize: 500,
      problemSelector: selector,
      sort: '-startTime',
    });
    candidates.push(...((response.problems ?? []) as unknown as Problem[]));

    for (let page = 0; response.nextPageKey && page < 3; page += 1) {
      response = await problemsClient.getProblems({ nextPageKey: response.nextPageKey });
      candidates.push(...((response.problems ?? []) as unknown as Problem[]));
    }

    const currentProblemId = problem.problemId ?? '';
    const currentDisplayId = problem.displayId ?? '';
    const currentEntities = new Set(affectedIds);
    const currentZones = new Set(managementZoneIds);
    const occurrences = candidates
      .filter((candidate) => {
        if ((candidate.problemId ?? '') === currentProblemId || (candidate.displayId ?? '') === currentDisplayId) return false;
        if ((candidate.title ?? '').trim() !== title) return false;
        const candidateEntities = entityIds(candidate.affectedEntities);
        const candidateZones = new Set(zoneIds(candidate.managementZones));
        return candidateEntities.some((entityId) => currentEntities.has(entityId))
          && [...candidateZones].some((zoneId) => currentZones.has(zoneId));
      })
      .map((candidate) => ({
        problemId: candidate.displayId ?? candidate.problemId ?? '',
        title: candidate.title ?? 'Dynatrace Problem',
        status: candidate.status ?? 'Not available',
        severity: candidate.severityLevel ?? 'Not available',
        start: candidate.startTime ? new Date(candidate.startTime).toISOString() : '',
        end: candidate.endTime !== undefined && candidate.endTime >= 0 ? new Date(candidate.endTime).toISOString() : '',
        duration: duration(candidate.startTime, candidate.endTime),
      }));

    return { count: occurrences.length, occurrences };
  } catch {
    return { count: 0, occurrences: [] };
  }
}


export default async function (payload: Payload) {
  if (!payload?.problemId || !/^P-\d+$/.test(payload.problemId)) {
    throw new Error('A valid Dynatrace Problem ID such as P-260948426 is required.');
  }

  // Popup path: exactly one native Problems API request. No DQL, logs, snapshots,
  // Smartscape lookups or Assist. This keeps the first-screen RCA deterministic
  // and comfortably below the AppEngine function execution limit.
  const response = await problemsClient.getProblems({
    from: 'now-365d',
    to: 'now',
    pageSize: 1,
    problemSelector: `displayId("${payload.problemId}")`,
    fields: 'evidenceDetails,impactAnalysis',
  });

  const problem = (Array.isArray(response.problems) ? response.problems[0] : undefined) as Problem | undefined;
  if (!problem) throw new Error(`Problem ${payload.problemId} was not found in the Dynatrace Problems API.`);

  const root = problem.rootCauseEntity?.name || '';
  const rootId = problem.rootCauseEntity?.entityId?.id || '';
  const rootType = problem.rootCauseEntity?.entityId?.type || '';
  const evidence = problem.evidenceDetails?.details ?? [];
  const relevant = evidence.filter((item) => item.rootCauseRelevant === true);
  const affected = (problem.affectedEntities ?? []).map((item) => item.name).filter((name): name is string => Boolean(name));
  const zones = (problem.managementZones ?? []).map((zone) => zone.name).filter((name): name is string => Boolean(name));
  const durationValue = duration(problem.startTime, problem.endTime);
  const eventEvidence = evidence.filter((item) => (item.evidenceType || '').toUpperCase() === 'EVENT');
  const recurrence = await loadRecurrenceCount(problem);
  const confidence = root ? 'High' : 'Not established';
  const rootLine = root
    ? `Dynatrace identified ${root} as the root-cause entity.`
    : 'Dynatrace did not expose a definitive root-cause entity for this problem.';

  const evidenceLines = relevant.slice(0, 6).map((item) => {
    const entity = item.entity?.name ? ` on ${item.entity.name}` : '';
    return `- ${item.displayName || item.evidenceType || 'Davis evidence'}${entity}`;
  });

  const analysis = `## Executive Summary
${rootLine} The finding is based on the native Dynatrace Problems API. Confidence: ${confidence}.

## Incident Overview
Title: ${problem.title || 'Dynatrace Problem'}
Status: ${problem.status || 'Not available'}
Severity: ${problem.severityLevel || 'Not available'}
Impact: ${problem.impactLevel || 'Not available'}
Duration: ${durationValue}
Affected entities: ${affected.join(', ') || 'Not available'}

## Root Cause Assessment
${rootLine}
Root-cause entity type: ${rootType || 'Not available'}
${root ? 'The root-cause entity is authoritative for this preview; the specific underlying technical trigger is not inferred.' : 'No root cause is claimed because Dynatrace did not expose one.'}

## Davis Evidence
${evidenceLines.length ? evidenceLines.join('\\n') : 'No root-cause-relevant evidence was returned by the Problems API.'}

## Immediate Actions
1. Validate the identified root-cause entity and current service health.
2. Correlate the evidence shown above with current telemetry before making a production change.
3. Open the full RCA for deeper Davis evidence analysis when additional recurrence, logs or telemetry correlation is required.

## Confidence
${confidence}. This popup preview does not infer an exception, deployment, resource saturation, dependency failure, or remediation result that is not present in the Problems API response.`;

  return {
    problemId: problem.problemId || payload.problemId,
    displayId: problem.displayId || payload.problemId,
    displayName: problem.title || 'Dynatrace Problem',
    analysis,
    generatedAt: new Date().toISOString(),
    nativeRootCauseEntity: root || null,
    definitiveRootCause: Boolean(root),
    assistAnalysis: '',
    assistFallback: true,
    assistStatus: 'Not used in fast popup preview',
    recurrenceWindow: 'Last 30 days · same title + affected entity + management zone',
    managementZones: zones,
    occurrenceCount: recurrence.count,
    occurrences: recurrence.occurrences,
    title: problem.title || 'Dynatrace Problem',
    alertDescription: problem.title || 'Dynatrace Problem',
    duration: durationValue,
    status: problem.status || 'Not available',
    severityLevel: problem.severityLevel || 'Not available',
    impactLevel: problem.impactLevel || 'Not available',
    startTime: problem.startTime ? new Date(problem.startTime).toISOString() : '',
    endTime: problem.endTime !== undefined && problem.endTime >= 0 ? new Date(problem.endTime).toISOString() : '',
    evidenceDetails: {
      details: evidence.slice(0, 8).map((item) => ({
        displayName: item.displayName || item.evidenceType || 'Davis evidence',
        evidenceType: item.evidenceType || '',
        rootCauseRelevant: item.rootCauseRelevant === true,
        entity: { name: item.entity?.name || '' },
      })),
    },
    impactAnalysis: { impacts: (problem.impactAnalysis?.impacts ?? []).slice(0, 8) },
    problemFacts: {
      title: problem.title || 'Dynatrace Problem',
      status: problem.status || 'Not available',
      severity: problem.severityLevel || 'Not available',
      impactLevel: problem.impactLevel || 'Not available',
      start: problem.startTime ? new Date(problem.startTime).toISOString() : '',
      end: problem.endTime !== undefined && problem.endTime >= 0 ? new Date(problem.endTime).toISOString() : '',
      duration: durationValue,
      affectedEntities: affected.join(', ') || 'Not available',
    },
    evidenceSummary: {
      correlatedEvents: eventEvidence.length,
      incidentLogs: 0,
      historicalOccurrences: recurrence.count,
      timelineSnapshots: 0,
    },
    problemAnalysis: {
      rootCause: root || 'Not identified by Davis',
      rootCauseEntityId: rootId || undefined,
      rootCauseEntityType: rootType || undefined,
      probableCause: root
        ? `Dynatrace exposed ${root} as the root-cause entity; the specific technical trigger is not established by this preview.`
        : 'Not established by available Problems API evidence.',
      impactSummary: `Impact level: ${problem.impactLevel || 'not available'}.`,
      remediation: 'Validate the root-cause signal and affected dependency before making a production change.',
      confidence,
      evidence: relevant.slice(0, 12).map((item) => item.displayName || item.evidenceType || 'Davis evidence'),
      eventIds: [],
      causalEvents: relevant.slice(0, 10).map((item) => ({
        id: '',
        name: item.displayName || item.evidenceType || 'Davis evidence',
        description: '',
        entityId: item.entity?.entityId?.id || '',
        entityType: item.entity?.entityId?.type || '',
      })),
      fullRca: analysis,
      assistAnalysis: '',
      assistFallback: true,
      assistStatus: 'Not used in fast popup preview',
      analysisReady: Boolean(root),
      affectedUsers: undefined,
      logs: [],
      historicalOccurrences: recurrence.occurrences,
      timelineSnapshots: [],
      managementZones: zones,
    },
  };
};
